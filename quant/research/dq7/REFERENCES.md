# DQ-7 references

Research checked on 2026-07-30. These references constrain the validator's
boundary; they do not turn a structural receipt into a statistical result.

1. Rundgren, Jordan, and Erdtman, [RFC 8785: JSON Canonicalization Scheme
   (JCS)](https://www.rfc-editor.org/rfc/rfc8785.html), June 2020. DQ-7 uses a
   narrower no-float, safe-integer, closed-key subset and adds one final LF.
2. Holm, [A Simple Sequentially Rejective Multiple Test
   Procedure](https://doi.org/10.2307/4615733), *Scandinavian Journal of
   Statistics* 6(2), 1979. This supports the registered Holm FWER method
   identifier; DQ-7 validates frozen membership, not the method's execution.
3. White, [A Reality Check for Data
   Snooping](https://doi.org/10.1111/1468-0262.00152), *Econometrica* 68(5),
   2000. This supports treating selection across a family of specifications as a
   program-level inference problem rather than relabeling each specification as
   independent.
4. Center for Open Science, [Welcome to
   Registrations](https://help.osf.io/article/330-welcome-to-registrations).
   Time-stamped, read-only preregistration motivates the explicit pre-outcome
   freeze field. DQ-7 records an attestation; it is not itself an external
   timestamping service.
5. U.S. Food and Drug Administration, [Multiple Endpoints in Clinical Trials:
   Guidance for
   Industry](https://www.fda.gov/media/162416/download?attachment=), October
   2022. The guidance supplies a current, authoritative account of multiplicity
   as inflated false-positive risk when multiple inferential opportunities are
   present. DQ-7 adopts the program-wide membership discipline, not the
   clinical-trial-specific procedures.
