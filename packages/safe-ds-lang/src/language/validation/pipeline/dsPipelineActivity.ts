/**
 * TypeScript mirror of the DSPipelineActivity enum defined in ideIntegration.sdsstub.
 * String values must exactly match the annotation variant names so that annotation
 * lookups in extractValidationContext() continue to work via `name as DSPipelineActivity`.
 */
export enum DSPipelineActivity {
    // Pre-Processing Layer
    DataAcquisitionQGeneral       = 'DataAcquisitionQGeneral',
    DataAcquisitionQPreprocessing = 'DataAcquisitionQPreprocessing',
    DataAcquisitionQConstruction  = 'DataAcquisitionQConstruction',

    DataPreparationQGeneral       = 'DataPreparationQGeneral',
    DataPreparationQExploration   = 'DataPreparationQExploration',
    DataPreparationQPreprocessing = 'DataPreparationQPreprocessing',
    DataPreparationQTransformation = 'DataPreparationQTransformation',
    DataPreparationQModification  = 'DataPreparationQModification',

    DataPartitioningQGeneral      = 'DataPartitioningQGeneral',

    DataProcessingQGeneral        = 'DataProcessingQGeneral',
    DataProcessingQExploration    = 'DataProcessingQExploration',
    DataProcessingQDataTransformer = 'DataProcessingQDataTransformer',
    DataProcessingQPreprocessing  = 'DataProcessingQPreprocessing',
    DataProcessingQTransformation = 'DataProcessingQTransformation',
    DataProcessingQModification   = 'DataProcessingQModification',

    // Model Building Layer
    FeatureEngineeringQGeneral         = 'FeatureEngineeringQGeneral',
    FeatureEngineeringQFeatureTransformer = 'FeatureEngineeringQFeatureTransformer',
    FeatureEngineeringQModification    = 'FeatureEngineeringQModification',
    FeatureEngineeringQConstruction    = 'FeatureEngineeringQConstruction',

    FeatureSelectionQGeneral      = 'FeatureSelectionQGeneral',

    ModelingQGeneral              = 'ModelingQGeneral',

    TrainingQGeneral              = 'TrainingQGeneral',

    PredictionQGeneral            = 'PredictionQGeneral',

    EvaluationQMetric             = 'EvaluationQMetric',
    EvaluationQVisualization      = 'EvaluationQVisualization',

    TestingQMetric                = 'TestingQMetric',
    TestingQVisualization         = 'TestingQVisualization',

    Any                           = 'Any',
}

/** Returns the phase portion of an activity name (the part before 'Q'). */
export function phaseOf(activity: DSPipelineActivity): string {
    const name = activity as string;
    const i = name.indexOf('Q');
    return i !== -1 ? name.slice(0, i) : name;
}

/** Returns the type portion of an activity name (the part after 'Q'). */
export function activityTypeOf(activity: DSPipelineActivity): string {
    const name = activity as string;
    const i = name.indexOf('Q');
    return i !== -1 ? name.slice(i + 1) : name;
}
