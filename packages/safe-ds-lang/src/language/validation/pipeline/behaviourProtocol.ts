import { DataSet } from '../../flow/safe-ds-dataset-identifier.js';
import { DSPipelineActivity } from './protocol/dsPipelineActivity.js';
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
        'DataAcquisition', 1
    ),
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQGeneral),
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQPreprocessing),
            new ElementaryBlock(DSPipelineActivity.DataAcquisitionQConstruction),
        ]),
        'DataAcquisition'
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
        'DataPreparation'
    ),

    // Data Partitioning
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.DataPartitioningQGeneral),
        'DataPartitioning', 1
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
        'DataProcessing'
    ),

// Model Building Layer
    // Feature Engineering
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQGeneral),
            new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQFeatureTransformer),
            new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQModification),
            new ElementaryBlock(DSPipelineActivity.FeatureEngineeringQConstruction),
        ]),
        'FeatureEngineering'
    ),

    // Feature Selection
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.FeatureSelectionQGeneral, DataSet.Training),
        'FeatureSelection'
    ),

    // Modeling
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.ModelingQGeneral),
        'Modeling', 1
    ),

    // Training
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.TrainingQGeneral),
        'Training', 1
    ),

    // Prediction
    new RepetitionBlock(
        new ElementaryBlock(DSPipelineActivity.PredictionQGeneral),
        'Prediction'
    ),

    // Evaluation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.EvaluationQMetric, DataSet.Validation),
            new ElementaryBlock(DSPipelineActivity.EvaluationQVisualization, DataSet.Validation),
        ]),
        'Evaluation', 1, Infinity, DataSet.Test
    ),

    // Testing
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock(DSPipelineActivity.TestingQMetric, DataSet.Test),
            new ElementaryBlock(DSPipelineActivity.TestingQVisualization, DataSet.Test),
        ]),
        'Testing'
    ),
])
