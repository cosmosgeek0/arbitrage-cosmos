"""Permissioned UDS and literal-loopback transport for Q16 local inference."""

from __future__ import annotations

import os
import socket
import socketserver
import stat
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import Final

from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.inference.service import LocalInferenceServiceV1
from quant_edge.primitives import require_utc_millis

MAX_UDS_PATH_BYTES: Final = 100
TrustedClock = int | Callable[[], int]


class LocalTransportError(QuantEdgeError):
    """Local transport configuration or filesystem safety failed closed."""


def require_literal_loopback(host: str) -> str:
    if host not in ("127.0.0.1", "::1"):
        raise LocalTransportError("TCP host must be literal IPv4 or IPv6 loopback")
    return host


def _prepare_socket_parent(path: Path) -> None:
    if not path.is_absolute() or len(os.fsencode(path)) > MAX_UDS_PATH_BYTES:
        raise LocalTransportError("UDS path must be absolute and fit the portable path budget")
    parent = path.parent
    try:
        if not parent.exists():
            parent.mkdir(mode=0o700, parents=True)
        info = parent.lstat()
    except OSError as error:
        raise LocalTransportError("UDS parent directory cannot be prepared") from error
    if parent.is_symlink() or not stat.S_ISDIR(info.st_mode):
        raise LocalTransportError("UDS parent must be a real directory")
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise LocalTransportError("UDS parent must be owned by this user with mode 0700")
    if path.exists() or path.is_symlink():
        raise LocalTransportError("UDS socket path collision is never unlinked implicitly")


def _handler(
    service: LocalInferenceServiceV1,
    fallback_now_ms: TrustedClock,
) -> type[socketserver.StreamRequestHandler]:
    class Handler(socketserver.StreamRequestHandler):
        def setup(self) -> None:
            super().setup()
            self.request.settimeout(service.limits.timeout_ms / 1_000)

        def handle(self) -> None:
            maximum = service.limits.request_bytes
            try:
                raw = self.rfile.readline(maximum + 2)
            except TimeoutError:
                service.record_transport_failure(code="TRANSPORT_TIMEOUT")
                return
            if not raw or len(raw) > maximum + 1 or not raw.endswith(b"\n"):
                service.record_transport_failure(code="FRAME_INVALID")
                return
            try:
                trusted_now_ms = fallback_now_ms() if callable(fallback_now_ms) else fallback_now_ms
                require_utc_millis(trusted_now_ms, field="trusted_now_ms")
                response = service.handle_bytes(raw[:-1], fallback_now_ms=trusted_now_ms)
                self.wfile.write(response + b"\n")
            except (OSError, QuantEdgeError, ValueError):
                service.record_transport_failure(code="TRANSPORT_IO_ERROR")

    return Handler


class _LifecycleMixin:
    daemon_threads = False
    block_on_close = True

    def __init__(self, *args: object, **kwargs: object) -> None:
        self._q16_serving = threading.Event()
        super().__init__(*args, **kwargs)

    def serve_forever(self, poll_interval: float = 0.5) -> None:
        self._q16_serving.set()
        try:
            super().serve_forever(poll_interval=poll_interval)  # type: ignore[misc]
        finally:
            self._q16_serving.clear()

    @property
    def q16_serving(self) -> bool:
        return self._q16_serving.is_set()


class _ThreadedLifecycleMixin(socketserver.ThreadingMixIn, _LifecycleMixin):
    def __init__(self, *args: object, **kwargs: object) -> None:
        self._q16_handler_slots = threading.BoundedSemaphore(1)
        self._q16_service: LocalInferenceServiceV1 | None = None
        self._q16_handler_lock = threading.RLock()
        self._q16_handler_active = 0
        super().__init__(*args, **kwargs)

    def configure_handler_bound(self, service: LocalInferenceServiceV1) -> None:
        capacity = service.limits.queue_capacity + service.limits.concurrency + 1
        self._q16_handler_slots = threading.BoundedSemaphore(capacity)
        self._q16_service = service

    @property
    def active_handler_count(self) -> int:
        with self._q16_handler_lock:
            return self._q16_handler_active

    def process_request(
        self,
        request: socket.socket | tuple[bytes, socket.socket],
        client_address: object,
    ) -> None:
        if not self._q16_handler_slots.acquire(blocking=False):
            if self._q16_service is not None:
                self._q16_service.record_connection_rejection()
            connection = request[1] if isinstance(request, tuple) else request
            connection.close()
            return
        with self._q16_handler_lock:
            self._q16_handler_active += 1
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._q16_handler_slots.release()
            with self._q16_handler_lock:
                self._q16_handler_active -= 1
            raise

    def process_request_thread(
        self,
        request: socket.socket | tuple[bytes, socket.socket],
        client_address: object,
    ) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._q16_handler_slots.release()
            with self._q16_handler_lock:
                self._q16_handler_active -= 1


class _UnixServer(_ThreadedLifecycleMixin, socketserver.UnixStreamServer):
    allow_reuse_address = False


class _Tcp4Server(_ThreadedLifecycleMixin, socketserver.TCPServer):
    address_family = socket.AF_INET
    allow_reuse_address = False


class _Tcp6Server(_ThreadedLifecycleMixin, socketserver.TCPServer):
    address_family = socket.AF_INET6
    allow_reuse_address = False


@dataclass(slots=True)
class LocalServerHandleV1:
    server: socketserver.BaseServer
    service: LocalInferenceServiceV1
    socket_path: Path | None
    socket_identity: tuple[int, int] | None

    def close(self) -> None:
        cleanup_error: LocalTransportError | None = None
        try:
            if isinstance(self.server, _LifecycleMixin) and self.server.q16_serving:
                self.server.shutdown()
            self.server.server_close()
            if self.socket_path is not None and self.socket_identity is not None:
                try:
                    info = self.socket_path.lstat()
                except FileNotFoundError:
                    info = None
                except OSError as error:
                    cleanup_error = LocalTransportError(
                        "UDS path cannot be inspected during shutdown"
                    )
                    cleanup_error.__cause__ = error
                    info = None
                if info is not None:
                    identity = (info.st_dev, info.st_ino)
                    if not stat.S_ISSOCK(info.st_mode) or identity != self.socket_identity:
                        cleanup_error = LocalTransportError(
                            "UDS path changed; refusing unsafe cleanup"
                        )
                    else:
                        self.socket_path.unlink()
        finally:
            self.service.close()
        if cleanup_error is not None:
            raise cleanup_error

    def __enter__(self) -> LocalServerHandleV1:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()


def create_unix_server(
    *,
    path: Path,
    service: LocalInferenceServiceV1,
    fallback_now_ms: TrustedClock,
) -> LocalServerHandleV1:
    if not isinstance(path, Path) or not isinstance(service, LocalInferenceServiceV1):
        raise ContractValueError("path/service types are invalid")
    if isinstance(fallback_now_ms, bool) or not (
        isinstance(fallback_now_ms, int) or callable(fallback_now_ms)
    ):
        raise ContractValueError("trusted clock must be an integer or callable")
    _prepare_socket_parent(path)
    server: _UnixServer | None = None
    created_identity: tuple[int, int] | None = None
    try:
        server = _UnixServer(
            str(path),
            _handler(service, fallback_now_ms),
            bind_and_activate=False,
        )
        server.configure_handler_bound(service)
        server.request_queue_size = service.limits.queue_capacity
        server.server_bind()
        bound_info = path.lstat()
        if not stat.S_ISSOCK(bound_info.st_mode):
            raise OSError("bound UDS path is not a socket")
        created_identity = (bound_info.st_dev, bound_info.st_ino)
        server.server_activate()
        os.chmod(path, 0o600)
        info = path.lstat()
    except OSError as error:
        if server is not None:
            server.server_close()
        if created_identity is not None:
            try:
                current = path.lstat()
            except FileNotFoundError:
                current = None
            if (
                current is not None
                and stat.S_ISSOCK(current.st_mode)
                and (current.st_dev, current.st_ino) == created_identity
            ):
                path.unlink()
        raise LocalTransportError("permissioned UDS server could not bind") from error
    if (
        not stat.S_ISSOCK(info.st_mode)
        or stat.S_IMODE(info.st_mode) != 0o600
        or (info.st_dev, info.st_ino) != created_identity
    ):
        server.server_close()
        current = path.lstat()
        if stat.S_ISSOCK(current.st_mode) and (current.st_dev, current.st_ino) == created_identity:
            path.unlink()
        raise LocalTransportError("UDS node did not retain socket type and mode 0600")
    return LocalServerHandleV1(
        server=server,
        service=service,
        socket_path=path,
        socket_identity=(info.st_dev, info.st_ino),
    )


def create_loopback_server(
    *,
    host: str,
    port: int,
    service: LocalInferenceServiceV1,
    fallback_now_ms: TrustedClock,
) -> LocalServerHandleV1:
    require_literal_loopback(host)
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65_535:
        raise ContractValueError("port must be an integer in 0..65535")
    if not isinstance(service, LocalInferenceServiceV1):
        raise ContractValueError("service must be LocalInferenceServiceV1")
    if isinstance(fallback_now_ms, bool) or not (
        isinstance(fallback_now_ms, int) or callable(fallback_now_ms)
    ):
        raise ContractValueError("trusted clock must be an integer or callable")
    try:
        server = (
            _Tcp6Server(
                (host, port),
                _handler(service, fallback_now_ms),
                bind_and_activate=False,
            )
            if host == "::1"
            else _Tcp4Server(
                (host, port),
                _handler(service, fallback_now_ms),
                bind_and_activate=False,
            )
        )
        server.configure_handler_bound(service)
        server.request_queue_size = service.limits.queue_capacity
        server.server_bind()
        server.server_activate()
    except OSError as error:
        raise LocalTransportError("literal-loopback server could not bind") from error
    return LocalServerHandleV1(server, service, None, None)
