export const FOUNDATION_FETCH_DENIED = 'FOUNDATION_IMPORT_PURITY_FETCH_DENIED';

export function installFoundationFetchDenial(target = globalThis) {
  const originalFetch = target.fetch;
  let attempts = 0;
  target.fetch = function foundationImportPurityFetchDenied() {
    attempts += 1;
    const error = new Error('network is forbidden in Foundation import-purity tests');
    error.code = FOUNDATION_FETCH_DENIED;
    throw error;
  };

  let negativeControlProven = false;
  try {
    target.fetch('https://foundation.invalid/negative-control');
  } catch (error) {
    negativeControlProven = error?.code === FOUNDATION_FETCH_DENIED;
  }
  if (!negativeControlProven || attempts !== 1) {
    target.fetch = originalFetch;
    throw new Error('Foundation fetch denial negative control did not fail closed');
  }
  attempts = 0;

  return Object.freeze({
    negativeControlProven,
    attempts: () => attempts,
    restore: () => {
      target.fetch = originalFetch;
    },
  });
}
