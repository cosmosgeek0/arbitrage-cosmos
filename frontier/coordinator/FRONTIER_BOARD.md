# FRONTIER_BOARD.md — coordinator-owned (run 0715f)

Base FRONTIER_BASE_SHA: f0168cb37bd04d21bc90591ab2256770de3b75bc (accepted Main, clean, pushed). Directive: Desktop Frontier.md sha256 4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad (sole optional-organ authority; all earlier organ/foundry drafts REFERENCE_ONLY). Critical path: role4-fix (RUN-A) untouched, highest priority; Frontier tests yield to it (section-0 semaphore).

| ID | Module | Branch (reserved) | Worktree | Root (reserved) | State |
| F0 | Dock | f-dock-0715f | ~/Desktop/f-dock | frontier/dock/** | SEALED FRONTIER_CONTRACT_READY e0ace68de5d5 (28/28; facet ANNOTATION_ADAPTER blocked) |
| F1 | VenueMesh | f-venue-0715f (reserved) | ~/Desktop/f-venue (RELEASED at dock SHA) | frontier/venue-mesh/** | IMPLEMENTATION RELEASED (D-LAUNCH-45) |
| F2 | PortfolioLab | f-lab-0715f (reserved) | ~/Desktop/f-lab (RELEASED at dock SHA) | frontier/portfolio-lab/** | IMPLEMENTATION RELEASED (D-LAUNCH-45) |
| F3 | StrategyArena | f-arena-0715f (reserved) | ~/Desktop/f-arena (RELEASED at dock SHA) | frontier/strategy-arena/** | IMPLEMENTATION RELEASED (D-LAUNCH-45) |
| F4 | OperatorGym | f-gym-0715f (reserved) | ~/Desktop/f-gym (not created) | frontier/operator-gym/** | SCOUT_LAUNCHED / WAITING_FOR_DOCK_SHA |
| F5 | ChangeRadar | f-radar-0715f (reserved) | ~/Desktop/f-radar (not created) | frontier/change-radar/** | SCOUT_LAUNCHED / WAITING_FOR_DOCK_SHA |
| F6 | Nerve | f-nerve-0715f (reserved) | ~/Desktop/f-nerve (not created) | frontier/nerve/** | SCOUT_LAUNCHED / WAITING_FOR_DOCK_SHA |
| F7 | Chronos | f-time-0715f (reserved) | ~/Desktop/f-time (not created) | frontier/chronos/** | SCOUT_LAUNCHED / WAITING_FOR_DOCK_SHA |
| F8 | EdgeMeter | f-edge-0715f (reserved) | ~/Desktop/f-edge (RELEASED at dock SHA) | frontier/edge-meter/** | IMPLEMENTATION RELEASED (D-LAUNCH-45) |
| F9 | Narrator | f-story-0715f (reserved) | ~/Desktop/f-story (not created) | frontier/narrator/** | SCOUT_LAUNCHED / WAITING_FOR_DOCK_SHA |
| F10 | Lineage | f-lineage-0715f (reserved) | ~/Desktop/f-lineage (not created) | frontier/lineage/** | SCOUT_LAUNCHED / WAITING_FOR_DOCK_SHA |
| F11 | LabelForge | f-labels-0715f (reserved) | ~/Desktop/f-labels (not created) | frontier/label-forge/** | SCOUT_LAUNCHED / WAITING_FOR_DOCK_SHA |
| F12 | ScenarioBank | f-scenes-0715f (reserved) | ~/Desktop/f-scenes (not created) | frontier/scenario-bank/** | SCOUT_LAUNCHED / WAITING_FOR_DOCK_SHA |
| F13 | DecisionLab | f-decide-0715f (reserved) | ~/Desktop/f-decide (RELEASED at dock SHA) | frontier/decision-lab/** | IMPLEMENTATION RELEASED (D-LAUNCH-45) |

Scout receipts → frontier/coordinator/scouts/<module>.json (canonicalized by coordinator from scout worktree outputs). No implementation worktree exists until the mechanical release.
