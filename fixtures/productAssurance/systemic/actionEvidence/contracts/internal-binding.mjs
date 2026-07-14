export function frozenPolicyActionMaterial(identity, discriminantValue) {
  return {
    schema: identity.actionSchema,
    step: identity.step,
    kind: discriminantValue,
    legId: identity.legId,
    orderType: identity.orderType,
    timeInForce: identity.timeInForce,
    quantity: identity.quantity,
    quantitySource: identity.quantitySource,
    price: identity.price,
    targetActionId: identity.targetActionId,
    dependsOnActualFillLegId: identity.dependsOnActualFillLegId,
    requiresConfirmedCancelActionId: identity.requiresConfirmedCancelActionId,
    exposureEffect: identity.exposureEffect,
    recoveryEvidenceRevision: identity.recoveryEvidenceRevision,
    targetExposureRevision: identity.targetExposureRevision,
    deadlineOffsetMs: identity.deadlineOffsetMs,
    ambiguityPosture: identity.ambiguityPosture,
  };
}

export function frozenControlActionMaterial(identity, actionClass) {
  if (actionClass === 'REPAIR_STEP') {
    return {
      type: 'SAFE_RESTART_COMPONENT',
      component: {
        schema: identity.componentReferenceSchema,
        owner: identity.componentOwner,
        id: identity.componentId,
        revision: identity.componentRevision,
        digest: identity.componentDigest,
      },
      restartMode: identity.restartMode,
    };
  }
  if (actionClass === 'HALT') {
    return { type: 'HALT', scope: identity.scope, retainSupervision: identity.retainSupervision };
  }
  return null;
}
