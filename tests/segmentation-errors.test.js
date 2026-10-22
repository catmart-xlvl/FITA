import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentationErrorCode} from '../server/segmentation.js';
test('Blender error uses terminal exception, not a code mentioned in a traceback source line',()=>{
 assert.equal(segmentationErrorCode("else require(False,'SEG_INVALID_MODE')\nrequire(key not in seen,'SEG_TRANSFER_AMBIGUOUS')\nValueError: SEG_TRANSFER_AMBIGUOUS\r\nBlender quit\n"),'SEG_TRANSFER_AMBIGUOUS');
 assert.equal(segmentationErrorCode("require(False,'SEG_INVALID_MODE')\nTypeError: unexpected argument\n"),'SEG_BLENDER_FAILED');
 assert.equal(segmentationErrorCode('ValueError: SEG_INVALID_MODE\n'),'SEG_INVALID_MODE');
});
