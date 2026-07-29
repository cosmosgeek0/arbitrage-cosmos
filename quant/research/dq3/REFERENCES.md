# DQ-3 reference ledger

Retrieved 2026-07-30. Statistical entries are primary papers or author-hosted
paper copies. Software entries are official project documentation. DQ-3 adds no
dependency and uses only the Python standard library at runtime.

## Statistical coordinate and multiplicity basis

- Halbert White, “A Reality Check for Data Snooping,” *Econometrica* 68(5),
  2000. DOI:
  [10.1111/1468-0262.00152](https://doi.org/10.1111/1468-0262.00152).
  [Author-course PDF](https://bashtage.github.io/kevinsheppard.com/files/teaching/mfe/advanced-econometrics/White.pdf).
  DQ-3 applies the joint-resample coordinate requirement: one resampled vector
  coordinate feeds every trial before the cross-trial maximum is taken.
- Joseph P. Romano and Michael Wolf, “Exact and Approximate Stepdown Methods for
  Multiple Hypothesis Testing,” *Journal of the American Statistical
  Association* 100(469), 2005. DOI:
  [10.1198/016214504000000539](https://doi.org/10.1198/016214504000000539).
- Joseph P. Romano and Michael Wolf, “Stepwise Multiple Testing as Formalized
  Data Snooping,” *Econometrica* 73(4), 2005. DOI:
  [10.1111/j.1468-0262.2005.00615.x](https://doi.org/10.1111/j.1468-0262.2005.00615.x).
- Ryan J. Sullivan, Allan Timmermann, and Halbert White, “Data-Snooping,
  Technical Trading Rule Performance, and the Bootstrap,” *Journal of Finance*
  54(5), 1999. DOI:
  [10.1111/0022-1082.00163](https://doi.org/10.1111/0022-1082.00163).
  DQ-3 binds the supplied complete attempted-trial universe rather than only
  successful or reported trials.
- Belinda Phipson and Gordon K. Smyth, “Permutation P-values Should Never Be
  Zero,” *Statistical Applications in Genetics and Molecular Biology* 9(1),
  2010. DOI:
  [10.2202/1544-6115.1585](https://doi.org/10.2202/1544-6115.1585).
  DQ-3 does not calculate p-values; consumers must freeze their finite-resample
  correction separately.
- Dimitris N. Politis and Joseph P. Romano, “The Stationary Bootstrap,”
  *Journal of the American Statistical Association* 89(428), 1994. DOI:
  [10.1080/01621459.1994.10476870](https://doi.org/10.1080/01621459.1994.10476870).
  DQ-3 does not claim a stationary-bootstrap implementation. It freezes an
  explicit circular fixed-block coordinate algorithm so the consumer cannot
  silently change the resampling method.

## PBO and sealed-holdout basis

- David H. Bailey, Jonathan Borwein, Marcos López de Prado, and Qiji Jim Zhu,
  “The Probability of Backtest Overfitting,” *Journal of Computational
  Finance* 20(4), 2016. DOI:
  [10.21314/JCF.2016.322](https://doi.org/10.21314/JCF.2016.322).
  [Author PDF](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf).
  DQ-3 freezes the synchronous `T x N` development matrix, equal disjoint
  blocks, every half-block combination, exact complements, and original row
  order.
- Cynthia Dwork, Vitaly Feldman, Moritz Hardt, Toniann Pitassi, Omer Reingold,
  and Aaron Roth, “The Reusable Holdout: Preserving Validity in Adaptive Data
  Analysis,” *Science* 349(6248), 2015. DOI:
  [10.1126/science.aaa9375](https://doi.org/10.1126/science.aaa9375).
  [arXiv 1506.02629](https://arxiv.org/abs/1506.02629).
- Avrim Blum and Moritz Hardt, “The Ladder: A Reliable Leaderboard for Machine
  Learning Competitions,” *PMLR* 37, 2015.
  [Primary proceedings page](https://proceedings.mlr.press/v37/blum15.html).
  These holdout references motivate the fail-closed zero-feedback precondition;
  DQ-3 itself grants no holdout-open authority.

## Official implementation references

- Python 3.13 `hashlib`:
  [official documentation](https://docs.python.org/3.13/library/hashlib.html).
  SHA-256 is the frozen digest primitive.
- Python 3.13 `json`:
  [official documentation](https://docs.python.org/3.13/library/json.html).
  DQ-3 uses sorted keys, compact separators, strict UTF-8, `allow_nan=False`,
  and one terminal newline.
- Python 3.13 `random`:
  [official documentation](https://docs.python.org/3.13/library/random.html).
  DQ-3 does not use `random.shuffle`; coordinates come from a fully specified
  SHA-256 rejection sampler.
- uv project synchronization:
  [official documentation](https://docs.astral.sh/uv/concepts/projects/sync/).
- pytest:
  [official documentation](https://docs.pytest.org/en/stable/).
- Hypothesis:
  [official documentation](https://hypothesis.readthedocs.io/en/latest/).
- Ruff:
  [official documentation](https://docs.astral.sh/ruff/).
- mypy:
  [official documentation](https://mypy.readthedocs.io/en/stable/).

The exact canonical base pins Python 3.13.14, uv 0.11.28, pytest 9.1.1,
Hypothesis 6.156.6, Ruff 0.15.21, and mypy 2.2.0. DQ-3 neither changes those
pins nor imports optional numerical packages.
