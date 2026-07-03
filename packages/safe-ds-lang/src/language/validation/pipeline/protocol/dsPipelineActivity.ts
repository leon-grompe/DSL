import { DSPipelinePhase } from "./dsPipelinePhase.js";

/**
 * TypeScript mirror of the DSPipelineActivity enum defined in ideIntegration.sdsstub.
 * String values must exactly match the annotation variant names so that annotation
 * lookups in extractValidationContext() continue to work via `name as DSPipelineActivity`.
 */
export enum DSPipelineActivity {
    // Acquisition
    DataAcquisitionQDataLoading          = 'DataAcquisitionQDataLoading',
    DataAcquisitionQDatatypeConstruction = 'DataAcquisitionQDatatypeConstruction',
    DataAcquisitionQUtilities            = 'DataAcquisitionQUtilities',

    // Preparation (pre-split)
    DataPreparationQExploration          = 'DataPreparationQExploration',
    DataPreparationQPreSplitCleaning     = 'DataPreparationQPreSplitCleaning',
    DataPreparationQSchemaModification   = 'DataPreparationQSchemaModification',
    DataPreparationQUtilities            = 'DataPreparationQUtilities',

    // Partitioning
    DataPartitioningQDatasetSplitting    = 'DataPartitioningQDatasetSplitting',

    // Processing (post-split)
    DataProcessingQExploration           = 'DataProcessingQExploration',
    DataProcessingQPostSplitCleaning     = 'DataProcessingQPostSplitCleaning',
    DataProcessingQSchemaModification    = 'DataProcessingQSchemaModification',
    DataProcessingQUtilities             = 'DataProcessingQUtilities',
    DataProcessingQDataTransformation    = 'DataProcessingQDataTransformation',
    DataProcessingQAugmentation          = 'DataProcessingQAugmentation',

    // Feature Engineering
    FeatureEngineeringQDatatypeConstruction     = 'FeatureEngineeringQDatatypeConstruction',
    FeatureEngineeringQSchemaModification       = 'FeatureEngineeringQSchemaModification',
    FeatureEngineeringQUtilities                = 'FeatureEngineeringQUtilities',
    FeatureEngineeringQEngineering              = 'FeatureEngineeringQEngineering',
    FeatureEngineeringQFeatureTransformation    = 'FeatureEngineeringQFeatureTransformation',

    // Feature Selection
    FeatureSelectionQSchemaModification       = 'FeatureSelectionQSchemaModification',
    FeatureSelectionQTabularDatasetConversion = 'FeatureSelectionQTabularDatasetConversion',

    // Model Building
    ModelingQModelCreation        = 'ModelingQModelCreation',
    TrainingQModelFitting         = 'TrainingQModelFitting',

    // Evaluation
    EvaluationQPrediction         = 'EvaluationQPrediction',
    EvaluationQMetricCalculation  = 'EvaluationQMetricCalculation',
    
    // Testing
    TestingQPrediction            = 'TestingQPrediction',
    TestingQMetricCalculation     = 'TestingQMetricCalculation',
    
    // Interpretation
    InterpretationQPostProcessing = 'InterpretationQPostProcessing',
    InterpretationQVisualization  = 'InterpretationQVisualization',

    // Wildcard
    Any                           = 'Any',
}

/** Returns the phase portion of an activity name (the part before 'Q'). */
export const phaseOf = (activity: DSPipelineActivity): string => {
    const name = activity as string;
    const i = name.indexOf('Q');
    return i !== -1 ? name.slice(0, i) : name;
}

/** Returns the type portion of an activity name (the part after 'Q'). */
export const activityTypeOf = (activity: DSPipelineActivity): string => {
    const name = activity as string;
    const i = name.indexOf('Q');
    return i !== -1 ? name.slice(i + 1) : name;
}

/** Returns all activities that belong to a given phase. */
export const getActivitiesFromPhase = (phase: DSPipelinePhase): DSPipelineActivity[] => {
    return Object
        .values(DSPipelineActivity)
        .filter((activity) => phaseOf(activity) === phase);
}