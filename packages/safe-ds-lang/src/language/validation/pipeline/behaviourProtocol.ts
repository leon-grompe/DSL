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
    // Data Acquisition (at least one load / hand-built datatype)
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQLoading),
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQDatatypeConstruction),
        ]),
        DSPipelinePhase.DataAcquisition, 1
    ),

    // Data Preparation (pre-split: deterministic cleaning, schema edits, image transforms, EDA, helpers)
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.DataPreparationQExploration),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQPreSplitCleaning),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQSchemaModification),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQUtilities),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQImageTransformation),
        ]),
        DSPipelinePhase.DataPreparation
    ),

    // Data Partitioning
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.DataPartitioningQSplit),
        DSPipelinePhase.DataPartitioning, 1
    ),

    // Data Processing (post-split). Exploration, post-split cleaning and augmentation are training-only.
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.DataProcessingQExploration, DataSet.Training),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQPostSplitCleaning, DataSet.Training),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQAugmentation, DataSet.Training),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQSchemaModification),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQUtilities),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQDataTransformer),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQImageTransformation),
        ]),
        DSPipelinePhase.DataProcessing
    ),

// Model Building Layer
    // Feature Engineering followed by Feature Selection, as one group that repeats once per dataset.
    // The inner pattern is (FE* FS+): zero or more feature-engineering activities and then at least one
    // feature-selection activity (column trimming and/or 'toTabularDataset'). Requiring each group to
    // *end* with a selection keeps feature selection at the conclusion of every engineering run.
    new RepetitionBlock(
        new SequenceBlock([
            // Feature Engineering (optional within the group)
            new RepetitionBlock(
                new AlternativeBlock([
                    new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQDatatypeConstruction),
                    new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQSchemaModification),
                    new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQUtilities),
                    new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQEngineering),
                    new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQFeatureTransformer),
                ]),
                DSPipelinePhase.FeatureEngineering
            ),

            // Feature Selection (at least once: every group must conclude with a selection)
            new RepetitionBlock(
                new AlternativeBlock([
                    new ElementaryBlock(DSPipelineActivity.FeatureSelectionQSchemaModification),
                    new ElementaryBlock(DSPipelineActivity.FeatureSelectionQTabularDatasetConversion),
                ]),
                DSPipelinePhase.FeatureSelection, 1
            ),
        ])
    ),

    // Modeling
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.ModelingQCreating),
        DSPipelinePhase.Modeling, 1
    ),

    // Training (optional: a loaded pretrained model may be used without fitting)
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.TrainingQFitting),
        DSPipelinePhase.Training
    ),

    // Evaluation (validation set only; prediction is folded in here). Exits when a test-set call appears.
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.EvaluationQPrediction, DataSet.Validation),
            new ElementaryBlock(DSPipelineActivity.EvaluationQMetric, DataSet.Validation),
            new ElementaryBlock(DSPipelineActivity.EvaluationQVisualization, DataSet.Validation),
        ]),
        DSPipelinePhase.Evaluation, 0, Infinity, DataSet.Test
    ),

    // Testing (test set only; prediction is folded in here)
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.TestingQPrediction, DataSet.Test),
            new ElementaryBlock(DSPipelineActivity.TestingQMetric, DataSet.Test),
            new ElementaryBlock(DSPipelineActivity.TestingQVisualization, DataSet.Test),
        ]),
        DSPipelinePhase.Testing
    ),

    // Interpretation (trailing, optional: post-processing such as inverse-transforming predictions)
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.InterpretationQPostProcessing),
        DSPipelinePhase.Interpretation
    ),
])
