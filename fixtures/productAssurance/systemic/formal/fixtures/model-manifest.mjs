export const MODEL_MANIFEST_SCHEMA = 'ip-assurance.s3.model-manifest.v1';
export const MODEL_BUNDLE_HASH_ALGORITHM = 'SHA256_SORTED_PATH_NUL_FILE_SHA256_NEWLINE';

const SHARED = Object.freeze([
  Object.freeze({ path: 'explicitState/common.mjs', sha256: 'addcb63ff97ef5ab089a70e20f8caf62180a58e50376caf087f8043ff4b846bb' }),
  Object.freeze({ path: 'explicitState/kernel.mjs', sha256: 'ce8e7d8ff6d56ec04cbca6d553a56c28bbe07e581233181fe76f71ed8628657d' }),
  Object.freeze({ path: 'explicitState/properties.mjs', sha256: '6a01b025ae1bd53c2c5676a21dad43dace19b4f1c8d32ebac95edcf8c502fd5e' }),
]);

function entry(modelId, bundleSha256, specificFiles) {
  return Object.freeze({
    modelId,
    modelVersion: '1.0.0',
    bundleSha256,
    files: Object.freeze([...SHARED, ...specificFiles].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  });
}

export const MODEL_MANIFEST = Object.freeze([
  entry('S3-M01-AMBIGUOUS-MUTATION', '3634a35b356c4a1166896d44ad7fe9d90f9c44b783f5a6bdb62566b0967b2ec7', [
    Object.freeze({ path: 'explicitState/model-01-ambiguous-mutation.mjs', sha256: '38801f3ff56c5a4b6d94dbb567cab0735bc678d32b98135ef8582f112f6eb6eb' }),
    Object.freeze({ path: 'tla/S3M01AmbiguousMutation.cfg', sha256: 'dcf5a01bc888f56b130cfcb7a1b50ca6c20d828ccfe29f56c6cdc4bd6e0a8767' }),
    Object.freeze({ path: 'tla/S3M01AmbiguousMutation.tla', sha256: '4a329cfa22773ec5b75758339384ca4d467915bfcd8ed20437a4e0e1c95285cd' }),
  ]),
  entry('S3-M02-TWO-LEG-RECOVERY', '1bcf207aa8f4e0e3ebb7a63a0d424dc2689f17c992aaec9979ab34d140784f3c', [
    Object.freeze({ path: 'explicitState/model-02-two-leg-recovery.mjs', sha256: '45b92c30ae946a32e445ffda0b446993ad8e8b22b52bfed5792cb87e24162f35' }),
    Object.freeze({ path: 'tla/S3M02TwoLegRecovery.cfg', sha256: '0074c668affc1c18160535978b48860b473827177a310627711cde84be16f4f2' }),
    Object.freeze({ path: 'tla/S3M02TwoLegRecovery.tla', sha256: '7f2b620e5080ff16e6144a61db5d02f69a22db6adeceec51b6ba9eb76bb6897a' }),
  ]),
  entry('S3-M03-EXECUTION-FENCING', '1387ed00b8f2385e034761befaf32f3c7c07ca2040f6f861ddd9d9e267610654', [
    Object.freeze({ path: 'explicitState/model-03-execution-fencing.mjs', sha256: 'a8647aec4a63a6d6b4c835c4a3c1e117d388d25a0f4fd0704a73eaeab38f1806' }),
    Object.freeze({ path: 'tla/S3M03ExecutionFencing.cfg', sha256: '6f09041189d7af40838e994e277ddff9848ba72b383d115600cac41a101d1bd0' }),
    Object.freeze({ path: 'tla/S3M03ExecutionFencing.tla', sha256: 'be57166b6010184cc72b3ccae779001d330f3547371064c958b720d08c591a1a' }),
  ]),
  entry('S3-M04-REPAIR-CAMPAIGN', 'e9602017842bfe83e4b2ff16b8dae6f9519b39de3443841c3c3e99ef47e67185', [
    Object.freeze({ path: 'explicitState/model-04-repair-campaign.mjs', sha256: '476cfd77bca9605eb1c99c2903810900ce14bf2e7aa8c976e3ec713d5cbe6403' }),
    Object.freeze({ path: 'tla/S3M04RepairCampaign.cfg', sha256: '9ceeb991362e6f800b5ee65260310e14767c04f770ebdf57a72e913e45483eb1' }),
    Object.freeze({ path: 'tla/S3M04RepairCampaign.tla', sha256: 'f4d0572201aaef9e4105c45d262f68a0a276e3455e2df8ff43671ba9679aa2b8' }),
  ]),
  entry('S3-M05-BORROW-LIABILITY', 'b207b9f974fdd966d8421d7a807aff240f631acf9cb815b0dcda8a57d5849dd3', [
    Object.freeze({ path: 'explicitState/model-05-borrow-liability.mjs', sha256: '6d8b1c370fddef5672fb002394269b6a6f4bb1ad69b9d9f3fae5bd456556b7eb' }),
    Object.freeze({ path: 'tla/S3M05BorrowLiability.cfg', sha256: 'c98a849c814a2bfe7ae6ffcf20ec1a77c1fd0f016f9f1caf2614d24ce06fb826' }),
    Object.freeze({ path: 'tla/S3M05BorrowLiability.tla', sha256: 'd5a19051087b268015471453d69ec8fc9c43ca52f85d01ce139d18c0c9af4605' }),
  ]),
  entry('S3-M06-HALT-RISK-REDUCTION', '48cf71c487cc095be6a6c1518930d9d1dd29fa61e9f3d700400943e0a847ebe5', [
    Object.freeze({ path: 'explicitState/model-06-halt-risk-reduction.mjs', sha256: '01cb98f8696be9885997daaae7af92470af9b63077d19e4f1f915f6897fa7a00' }),
    Object.freeze({ path: 'tla/S3M06HaltRiskReduction.cfg', sha256: '52643b69799163da2868e1c993a1eefba3e220a275d1941e2d8c32efeb920249' }),
    Object.freeze({ path: 'tla/S3M06HaltRiskReduction.tla', sha256: 'df28c56e07518f8f9e9ddac4252ab4fdcd548511997b6e87600ec1b6f0aa1f27' }),
  ]),
  entry('S3-M07-CANCELLATION-BOUNDARY', '3ee2a6cb1b00da7f23758baef2a5b48f370172592f1f3cfc7bd232843d878e10', [
    Object.freeze({ path: 'explicitState/model-07-cancellation-boundary.mjs', sha256: 'a3f36d2d097d379fcfb10ac33757f5ea9be82c11b2a5c94dc1ceeb4ea31349e1' }),
    Object.freeze({ path: 'tla/S3M07CancellationBoundary.cfg', sha256: '333d30a2ac19c5a3573812f39ce2f9b885ad56530f191b74b634aa3fb8a5c2b7' }),
    Object.freeze({ path: 'tla/S3M07CancellationBoundary.tla', sha256: '8b006bed8ebce361ee40baed2521e842aeded414f17058321556642c4b8f2d4c' }),
  ]),
  entry('S3-M08-ORDER-POLICY', '64f46764d283909d9c3650e2b602835330e7002706c203bd0faa9e2109a6321b', [
    Object.freeze({ path: 'explicitState/model-08-order-policy.mjs', sha256: 'a19a55a5f466882e2d4fad457843991064be4ef797ed0bd474753783ca30dd6e' }),
    Object.freeze({ path: 'tla/S3M08OrderPolicy.cfg', sha256: 'c5d24ce501fffb17db718fde280b94fbb9f9e9f7e393ef5418732f8fcf25c90b' }),
    Object.freeze({ path: 'tla/S3M08OrderPolicy.tla', sha256: '65dd83c58a3b243d25c411b9df09d81136e39a81d5d59e5670c7388c5d80173a' }),
  ]),
  entry('S3-M09-NORMAL-BASIS-LIFECYCLE', 'feea373a30dea38e8807d441e3d22ce15871ce148a526eee5a63d6de60553b11', [
    Object.freeze({ path: 'explicitState/model-09-normal-basis-lifecycle.mjs', sha256: 'bc44bcdf99921b196324d6baef9552c70e118d8b81320825168b22bfb992ad52' }),
    Object.freeze({ path: 'tla/S3M09NormalBasisLifecycle.cfg', sha256: '947b03d8346c652796d4583ab804fdec21e75ad8411fdb5b96f24f7057ca5145' }),
    Object.freeze({ path: 'tla/S3M09NormalBasisLifecycle.tla', sha256: '1b024a46b09d36c315051f7b6ec9e990105a9d7564bf8d973973c7655cb117a8' }),
  ]),
  entry('S3-M10-REVERSE-BASIS-LIABILITY', 'b2e4b7dd065670d7054c2e5a915965ab553e4b985aa4e68a02ce4f7eb528ad22', [
    Object.freeze({ path: 'explicitState/model-10-reverse-basis-liability.mjs', sha256: '1f3833d2a98634851d39732dfc570a7b8d86aeb9ca55b731cb0f7cc7177bd183' }),
    Object.freeze({ path: 'tla/S3M10ReverseBasisLiability.cfg', sha256: '07a63cf0e5bce1cbe4860a88ce64c80a917518c7b08b52f2829a8f5c36298697' }),
    Object.freeze({ path: 'tla/S3M10ReverseBasisLiability.tla', sha256: '384f8550c8ee4655da11bdb7d32196178a178c2a0ceb15045e54260aff7e04e6' }),
  ]),
  entry('S3-M11-VOLUME-LIFECYCLE', 'c83d7fcad1e7e761ed6ef7db0fe0ba9321b7dd866fb41c10a623272a3fe076e4', [
    Object.freeze({ path: 'explicitState/model-11-volume-lifecycle.mjs', sha256: 'fb593dea12bd8cf5bcdecf436550c4c3d15500178900242c98a8a4c189284821' }),
    Object.freeze({ path: 'tla/S3M11VolumeLifecycle.cfg', sha256: '48e222e02b33e5a654a588d6c1c121a07dd8d5dcc546bb6d5d605678e0d73a3d' }),
    Object.freeze({ path: 'tla/S3M11VolumeLifecycle.tla', sha256: 'a573ad63626e905b3e483f63b6160cc421b998b0079b4bf44bbb8aa9d6700c3e' }),
  ]),
  entry('S3-M12-EXCHANGE-TWIN-AMBIGUITY', 'b69b785c129b07d9858d98be740375d97ad65fffe462893128fe5e6e57df5902', [
    Object.freeze({ path: 'explicitState/model-12-exchange-twin-ambiguity.mjs', sha256: '68fafb3d126407fd571438a43bb54cf37eb6dc628b1c10ffdb411bd04754aac0' }),
    Object.freeze({ path: 'tla/S3M12ExchangeTwinAmbiguity.cfg', sha256: '359ca843d1a2f2dde70061922d7952fc052833a547f7f8344c038f371650a9b1' }),
    Object.freeze({ path: 'tla/S3M12ExchangeTwinAmbiguity.tla', sha256: '6afbc9a8e4cd60eedb25dcf1d0a8828dfbb11d97bc541e5d49fb60e6bb44204a' }),
  ]),
  entry('S3-M13-DURABLE-CONTROL-REVISION', 'afa61ceccb89f3aa401e17b5d111dbcb121b09b08786a890a46651e651da0ecc', [
    Object.freeze({ path: 'explicitState/model-13-durable-control-revision.mjs', sha256: 'ef498b676f4fa0759dbe2b31c23bda5036353adef020597c485e7465accd790e' }),
    Object.freeze({ path: 'tla/S3M13DurableControlRevision.cfg', sha256: 'abbcfd89e2b4c0b32881aec0e4f729bfd685e4acbd2a1a5f1431fc4d0975ea46' }),
    Object.freeze({ path: 'tla/S3M13DurableControlRevision.tla', sha256: '9796d6bbf137013d776786a6764db96e4d378d8109dbecd55770babd617f07a4' }),
  ]),
]);

export const MODEL_MANIFEST_BY_ID = Object.freeze(Object.fromEntries(MODEL_MANIFEST.map((row) => [row.modelId, row])));
export const MODEL_HASHES = Object.freeze(Object.fromEntries(MODEL_MANIFEST.map((row) => [row.modelId, row.bundleSha256])));
