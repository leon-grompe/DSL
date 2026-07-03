import { DataSet } from '../../flow/safe-ds-dataset-identifier.js';
import { DSPipelineActivity } from './protocol/dsPipelineActivity.js';
import { DSPipelinePhase } from './protocol/dsPipelinePhase.js';
import { ElementaryBlock, AlternativeBlock, RepetitionBlock, SequenceBlock } from './protocol/model.js';

/**
 * Full behaviour protocol based on best practices and common data science pitfalls.
 * A pipeline should follow this protocol to prevent domain specific mistakes like data leakage.
*/
export const behaviourProtocol = new SequenceBlock([
// Pre-Processing Layer
    // Data Acquisition (at least one load / hand-built datatype). Utilities allowed for pre-split table assembly.
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQDataLoading),
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQDatatypeConstruction),
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQUtilities),
        ]),
        DSPipelinePhase.DataAcquisition, 1
    ),

    // Data Preparation (pre-split: deterministic cleaning, schema edits, EDA, helpers)
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.DataPreparationQExploration),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQPreSplitCleaning),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQUtilities),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQSchemaModification),
        ]),
        DSPipelinePhase.DataPreparation
    ),

    // Data Partitioning
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.DataPartitioningQDataSplitting),
        DSPipelinePhase.DataPartitioning, 1
    ),

    // Data Processing (post-split). Exploration, post-split cleaning and augmentation are training-only.
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.DataProcessingQExploration, 
                DataSet.Training),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQPostSplitCleaning, 
                DataSet.Training),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQAugmentation, 
                DataSet.Training),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQDataTransformation),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQUtilities),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQSchemaModification),
        ]),
        DSPipelinePhase.DataProcessing
    ),

// Model Building Layer
    // Feature Engineering    
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQEngineering),
            new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQFeatureTransformation),
            new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQUtilities),
            new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQSchemaModification),
            new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQDatatypeConstruction),
        ]),
        DSPipelinePhase.FeatureEngineering
    ),

    // Feature Selection (at least once: every group must conclude with a selection)
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.FeatureSelectionQTabularDatasetConversion),
            new ElementaryBlock(DSPipelineActivity.FeatureSelectionQSchemaModification),
        ]),
        DSPipelinePhase.FeatureSelection, 1
    ),

    // Modeling
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.ModelingQModelCreation),
        DSPipelinePhase.Modeling, 1
    ),

    // Training (optional: a loaded pretrained model may be used without fitting)
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.TrainingQModelFitting),
        DSPipelinePhase.Training
    ),

    // Evaluation (validation set only). Exits when a test-set call appears, to transition into Testing phase.
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.EvaluationQPrediction, 
                DataSet.Validation),
            new ElementaryBlock(DSPipelineActivity.EvaluationQMetricCalculation,
                DataSet.Validation),
        ]),
        DSPipelinePhase.Evaluation, 0, Infinity, DataSet.Test
    ),

    // Testing (test set only)
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.TestingQPrediction, 
                DataSet.Test),
            new ElementaryBlock(DSPipelineActivity.TestingQMetricCalculation,
                DataSet.Test),
        ]),
        DSPipelinePhase.Testing
    ),

    // Interpretation (trailing, optional: inverse-transforming predictions, visualizing the model)
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.InterpretationQPostProcessing),
            new ElementaryBlock(DSPipelineActivity.InterpretationQVisualization),
        ]),
        DSPipelinePhase.Interpretation
    ),
])
