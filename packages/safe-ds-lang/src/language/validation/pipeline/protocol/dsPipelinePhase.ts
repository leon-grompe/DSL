/**
 * Encodes the phases in a data science pipeline.
 */
export enum DSPipelinePhase {
    DataAcquisition     = 'DataAcquisition',
    DataPreparation     = 'DataPreparation',
    DataPartitioning    = 'DataPartitioning',
    DataProcessing      = 'DataProcessing',
    FeatureEngineering  = 'FeatureEngineering',
    FeatureSelection    = 'FeatureSelection',
    Modeling            = 'Modeling',
    Training            = 'Training',
    Evaluation          = 'Evaluation',
    Testing             = 'Testing',
    Interpretation      = 'Interpretation'
}

/** Phases in protocol order (the enum declaration order matches the sequence in behaviourProtocol.ts). */
const PHASE_ORDER: DSPipelinePhase[] = Object.values(DSPipelinePhase);

/** Returns the phase that follows the given one in protocol order, or undefined for the last (or unknown) phase. */
export const nextPhaseOf = (phase: string): DSPipelinePhase | undefined => {
    const index = PHASE_ORDER.indexOf(phase as DSPipelinePhase);
    return index >= 0 ? PHASE_ORDER[index + 1] : undefined;
};

/**
 * Per-phase guidance: a short description what to do in each phase. Rendered after `Fix: `,
 * so each entry is lowercase and reads as the completion of "Fix: ...".
 * Only shows if a phase is required (min > 0). Currently required phases are: DataAcquisition, DataPartitioning and Modeling.
 */
const PHASE_GUIDANCE: Record<DSPipelinePhase, string> = {
    [DSPipelinePhase.DataAcquisition]: 'load a dataset or construct one by hand before doing anything else.',
    [DSPipelinePhase.DataPreparation]: 'clean, reshape or explore the whole dataset before splitting.',
    [DSPipelinePhase.DataPartitioning]: 'split the data into at least training and test sets before any post-split step.',
    [DSPipelinePhase.DataProcessing]: 'process data on every partition consistently, or explore/clean/augment the training set only.',
    [DSPipelinePhase.FeatureEngineering]: 'engineer features on every partition consistently.',
    [DSPipelinePhase.FeatureSelection]: 'trim columns and/or convert to a tabular dataset before modeling.',
    [DSPipelinePhase.Modeling]: 'create a model first.',
    [DSPipelinePhase.Training]: 'fit the model on the training set first.',
    [DSPipelinePhase.Evaluation]: 'evaluate the model on the validation set to optimize hyperparameters.',
    [DSPipelinePhase.Testing]: 'test the model on the test set to test its generality on unseen data.',
    [DSPipelinePhase.Interpretation]: 'interpret the results through model visualization or inverse-transformation of target features.',
};
/** Looks up the short `Fix:` hint for a phase, if any. */
export const guidanceForPhase = (phase: string): string | undefined => {
    return PHASE_GUIDANCE[phase as DSPipelinePhase];
};