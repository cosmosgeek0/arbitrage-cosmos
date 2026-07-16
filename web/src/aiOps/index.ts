export { AiOpsWorkspace, AI_OPS_LOCAL_VIEWS, type AiOpsLocalView, type AiOpsWorkspaceProps } from './AiOpsWorkspace';
export {
  ABSOLUTE_HARD_DENIALS,
  AI_OPS_CONTROL_CATEGORIES,
  FORBIDDEN_CAPABILITY_REACHABILITY,
  buildAiOpsControlSpecificationProjection,
  projectNarrowingControlIntent,
  validateControlSpecificationProjection,
} from './controlProjection';
export {
  DEFAULT_AI_OPS_FIXTURE_MANIFEST,
  DEFAULT_AI_OPS_SHADOW_FIXTURE,
  buildAiOpsShadowFixture,
} from './fixture';
export * from './types';
