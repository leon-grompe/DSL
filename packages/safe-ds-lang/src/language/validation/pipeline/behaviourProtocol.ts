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
    // Data Acquisition
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.DataAcquisitionQGeneral),
        DSPipelinePhase.DataAcquisition, 1
    ),
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQGeneral),
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQPreprocessing),
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQConstruction),
        ]),
        DSPipelinePhase.DataAcquisition
    ),

    // Data Preparation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.DataPreparationQGeneral),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQExploration),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQPreprocessing),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQTransformation),
            new ElementaryBlock(DSPipelineActivity.DataPreparationQModification),
        ]),
        DSPipelinePhase.DataPreparation
    ),

    // Data Partitioning
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.DataPartitioningQGeneral),
        DSPipelinePhase.DataPartitioning, 1
    ),

    // Data Processing
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.DataProcessingQGeneral),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQExploration, DataSet.Training),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQDataTransformer),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQPreprocessing),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQTransformation),
            new ElementaryBlock(DSPipelineActivity.DataProcessingQModification),
        ]),
        DSPipelinePhase.DataProcessing
    ),

// Model Building Layer
    // Feature Engineering followed by Feature Selection, as one group that repeats once per dataset.
    // The inner pattern is (FE* FS+): zero or more feature-engineering activities ('transformTable', …)
    // and then at least one feature-selection activity ('toTabularDataset'). Requiring each group to
    // *end* with a selection keeps feature selection at the conclusion of every engineering run, so
    // "do some feature engineering, select, then do more engineering without ever selecting again" is
    // rejected. Repeating the group still admits both shapes we want:
    //   - all engineering then all selection (one group): every partition is transformed, then every
    //     partition is converted to a dataset;
    //   - per-dataset chains (one group each): 'training.transformTable(t).toTabularDataset(...)' then
    //     the same for the test set.
    new RepetitionBlock(
        new SequenceBlock([
            // Feature Engineering (optional within the group)
            new RepetitionBlock(
                new AlternativeBlock([
                    new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQGeneral),
                    new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQFeatureTransformer),
                    new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQModification),
                    new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQConstruction),
                ]),
                DSPipelinePhase.FeatureEngineering
            ),

            // Feature Selection (at least once: every group must conclude with a selection)
            new RepetitionBlock(
                new ElementaryBlock(DSPipelineActivity.FeatureSelectionQGeneral),
                DSPipelinePhase.FeatureSelection, 1
            ),
        ])
    ),

    // Modeling
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.ModelingQGeneral),
        DSPipelinePhase.Modeling, 1
    ),

    // Training
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.TrainingQGeneral),
        DSPipelinePhase.Training, 1
    ),

    // Prediction
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.PredictionQGeneral),
        DSPipelinePhase.Prediction
    ),

    // Evaluation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.EvaluationQMetric, DataSet.Validation),
            new ElementaryBlock(DSPipelineActivity.EvaluationQVisualization, DataSet.Validation),
        ]),
        DSPipelinePhase.Evaluation, 1, Infinity, DataSet.Test
    ),

    // Testing
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.TestingQMetric, DataSet.Test),
            new ElementaryBlock(DSPipelineActivity.TestingQVisualization, DataSet.Test),
        ]),
        DSPipelinePhase.Testing
    ),
])
