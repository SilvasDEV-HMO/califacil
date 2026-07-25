export { preprocessForSheetDetection } from '@/lib/omr/preprocess';
export { refineWarpedSheetFiducials, REFINE_WARP_MAX_ITERATIONS, REFINE_WARP_TARGET_MAX_ERROR_PX } from '@/lib/omr/refine-warp';
export { computeHomographySrcToDst, warpCanvasWithHomography } from '@/lib/omr/homography';
export { validateAnswerSheetGeometry, type AnswerSheetGeometryValidation } from '@/lib/omr/validate-geometry';
export {
  warpCalifacilMobileCapture,
  warpCalifacilMobileCaptureFast,
  normalizeCalifacilGradeDocumentCanvas,
  CALIFACIL_GRADE_DOCUMENT_MAX_SIDE,
  prepareCalifacilGradeScanCanvas,
  prepareCalifacilGradeScanCanvases,
  isMobileLetterGradeCanvasReady,
  type CalifacilGradeScanCanvases,
  type MobileWarpPipelineResult,
  type NormalizeGradeDocumentResult,
  type RoiQuad,
} from '@/lib/omr/pipeline';
export {
  alignCanvasToReferenceGrade,
  buildReferenceAnchoredGeometry,
  buildDesktopDisplayOverlayGeometry,
  isReferenceGradeExam,
  prepareReferenceGradeCanvas,
  canvasMatchesReferenceGrade,
  isReferenceGradeCanvasAnchor,
} from '@/lib/omr/reference-grade';
export {
  scanDesktopGradeUnifiedOrLegacy,
  scanDesktopGradeUnifiedOrLegacyAsync,
  scanWarpedGradeUnifiedOrLegacy,
  scanWarpedGradeUnifiedOrLegacyAsync,
  scanWarpedGradeMobileAsync,
  scanLiveOmrUnifiedOrLegacy,
} from '@/lib/omr/unified-grade-scan';
export {
  runUnifiedOmrPipeline,
  isUnifiedOmrEngineEnabled,
  enableUnifiedOmrEngineForBenchmark,
} from '@/lib/omr/engine';
