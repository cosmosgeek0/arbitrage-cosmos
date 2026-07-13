export const MODEL_MANIFEST_SCHEMA = 'ip-assurance.s3.model-manifest.v1';
export const MODEL_BUNDLE_HASH_ALGORITHM = 'SHA256_SORTED_PATH_NUL_FILE_SHA256_NEWLINE';

const SHARED = Object.freeze([
  Object.freeze({ path: 'explicitState/common.mjs', sha256: 'addcb63ff97ef5ab089a70e20f8caf62180a58e50376caf087f8043ff4b846bb' }),
  Object.freeze({ path: 'explicitState/kernel.mjs', sha256: 'ce8e7d8ff6d56ec04cbca6d553a56c28bbe07e581233181fe76f71ed8628657d' }),
  Object.freeze({ path: 'explicitState/properties.mjs', sha256: '590afcc2a67c18f384953a544a2f5ab111024c27ced28757a4e54e843f3cd119' }),
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
  entry('S3-M01-AMBIGUOUS-MUTATION', 'b402150c2b791c53c8ed00675c587bc3910efdc29f851e7f70e63563e070f01d', [
    Object.freeze({ path: 'explicitState/model-01-ambiguous-mutation.mjs', sha256: '38801f3ff56c5a4b6d94dbb567cab0735bc678d32b98135ef8582f112f6eb6eb' }),
    Object.freeze({ path: 'tla/S3M01AmbiguousMutation.cfg', sha256: 'dcf5a01bc888f56b130cfcb7a1b50ca6c20d828ccfe29f56c6cdc4bd6e0a8767' }),
    Object.freeze({ path: 'tla/S3M01AmbiguousMutation.tla', sha256: '4a329cfa22773ec5b75758339384ca4d467915bfcd8ed20437a4e0e1c95285cd' }),
  ]),
  entry('S3-M02-TWO-LEG-RECOVERY', 'ea509199bb9db54c7857e88520d36aac7a00a3ff2331d9db8c44a44e70220b28', [
    Object.freeze({ path: 'explicitState/model-02-two-leg-recovery.mjs', sha256: '45b92c30ae946a32e445ffda0b446993ad8e8b22b52bfed5792cb87e24162f35' }),
    Object.freeze({ path: 'tla/S3M02TwoLegRecovery.cfg', sha256: '0074c668affc1c18160535978b48860b473827177a310627711cde84be16f4f2' }),
    Object.freeze({ path: 'tla/S3M02TwoLegRecovery.tla', sha256: '7f2b620e5080ff16e6144a61db5d02f69a22db6adeceec51b6ba9eb76bb6897a' }),
  ]),
  entry('S3-M03-EXECUTION-FENCING', 'b6b07edef27284eae28432fcff34544bc502645c2c39ae1d3bb242aa868e2f6e', [
    Object.freeze({ path: 'explicitState/model-03-execution-fencing.mjs', sha256: 'a8647aec4a63a6d6b4c835c4a3c1e117d388d25a0f4fd0704a73eaeab38f1806' }),
    Object.freeze({ path: 'tla/S3M03ExecutionFencing.cfg', sha256: '6f09041189d7af40838e994e277ddff9848ba72b383d115600cac41a101d1bd0' }),
    Object.freeze({ path: 'tla/S3M03ExecutionFencing.tla', sha256: 'be57166b6010184cc72b3ccae779001d330f3547371064c958b720d08c591a1a' }),
  ]),
  entry('S3-M04-REPAIR-CAMPAIGN', '1ef82b7e3bd460310484e6fdc3cff3e057f3cef89682cda12fe2233d0d19457c', [
    Object.freeze({ path: 'explicitState/model-04-repair-campaign.mjs', sha256: '476cfd77bca9605eb1c99c2903810900ce14bf2e7aa8c976e3ec713d5cbe6403' }),
    Object.freeze({ path: 'tla/S3M04RepairCampaign.cfg', sha256: '9ceeb991362e6f800b5ee65260310e14767c04f770ebdf57a72e913e45483eb1' }),
    Object.freeze({ path: 'tla/S3M04RepairCampaign.tla', sha256: 'f4d0572201aaef9e4105c45d262f68a0a276e3455e2df8ff43671ba9679aa2b8' }),
  ]),
  entry('S3-M05-BORROW-LIABILITY', 'f794e6c70b3ebd5232e28bdc0c1ba19abaed9cb802d9e9725aad22161b7edf79', [
    Object.freeze({ path: 'explicitState/model-05-borrow-liability.mjs', sha256: '6d8b1c370fddef5672fb002394269b6a6f4bb1ad69b9d9f3fae5bd456556b7eb' }),
    Object.freeze({ path: 'tla/S3M05BorrowLiability.cfg', sha256: 'c98a849c814a2bfe7ae6ffcf20ec1a77c1fd0f016f9f1caf2614d24ce06fb826' }),
    Object.freeze({ path: 'tla/S3M05BorrowLiability.tla', sha256: 'd5a19051087b268015471453d69ec8fc9c43ca52f85d01ce139d18c0c9af4605' }),
  ]),
  entry('S3-M06-HALT-RISK-REDUCTION', '381fbadf60f865db29df624dfbb1943953e58ab9a583c19dd5b5d9ea4c7d5702', [
    Object.freeze({ path: 'explicitState/model-06-halt-risk-reduction.mjs', sha256: '01cb98f8696be9885997daaae7af92470af9b63077d19e4f1f915f6897fa7a00' }),
    Object.freeze({ path: 'tla/S3M06HaltRiskReduction.cfg', sha256: '52643b69799163da2868e1c993a1eefba3e220a275d1941e2d8c32efeb920249' }),
    Object.freeze({ path: 'tla/S3M06HaltRiskReduction.tla', sha256: 'df28c56e07518f8f9e9ddac4252ab4fdcd548511997b6e87600ec1b6f0aa1f27' }),
  ]),
  entry('S3-M07-CANCELLATION-BOUNDARY', '3a0008bf988f3a7e89ad22ae38c5a8bc4a8b44e18c5315d2583dcd6cfb7ee85c', [
    Object.freeze({ path: 'explicitState/model-07-cancellation-boundary.mjs', sha256: 'a3f36d2d097d379fcfb10ac33757f5ea9be82c11b2a5c94dc1ceeb4ea31349e1' }),
    Object.freeze({ path: 'tla/S3M07CancellationBoundary.cfg', sha256: '333d30a2ac19c5a3573812f39ce2f9b885ad56530f191b74b634aa3fb8a5c2b7' }),
    Object.freeze({ path: 'tla/S3M07CancellationBoundary.tla', sha256: '8b006bed8ebce361ee40baed2521e842aeded414f17058321556642c4b8f2d4c' }),
  ]),
]);

export const MODEL_MANIFEST_BY_ID = Object.freeze(Object.fromEntries(MODEL_MANIFEST.map((row) => [row.modelId, row])));
export const MODEL_HASHES = Object.freeze(Object.fromEntries(MODEL_MANIFEST.map((row) => [row.modelId, row.bundleSha256])));
