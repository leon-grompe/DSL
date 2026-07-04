import { ProtocolViolation, DatasetMismatchError } from './protocolErrors.js'
import { ValidationResult } from './validationResult.js';
import { ProtocolObserver } from './observer.js';
import { SafeDsServices } from '../../../safe-ds-module.js';
import { SdsCall, SdsStatement } from '../../../generated/ast.js';
import { DataSet, SafeDsDatasetIdentifier } from '../../../flow/safe-ds-dataset-identifier.js';
import { DSPipelineActivity } from './dsPipelineActivity.js';
import { DSPipelinePhase } from './dsPipelinePhase.js';


export type Activity = DSPipelineActivity;

/**
 * Context the protocol validation needs to validate a sequence of activites.
 */
export class ValidationContext {
    public currentPhaseName: string | undefined = undefined;

    constructor(
        /** Sequence of activities in the pipeline. */
        public activitySequence: Activity[][],
        /** Calls in the pipeline. */
        public calls: SdsCall[],
        /** Call sites of segments to trace errors back to pipeline level. */
        public segmentCallSites: (SdsCall | undefined)[],
        /** Statements in the pipeline .*/
        public statements: SdsStatement[],
        /** Attached observers to provide additional validation logic. */
        public observers: ProtocolObserver[] = [],
    ){}
}

/**
 * Abstract base class for protocol blocks.
 * Protocol Blocks can be elementary, sequences of blocks, repetitions of a block, or alternatives between blocks.
 * Using these Blocks a regular-expression-like structure can be created to define a valid sequence of activities.
 */
export abstract class ProtocolBlock {
    /**
     * Validates a sequence of activities against the protocol block.
     * @param context Context needed to validate an activity sequence.
     * @param startIndex The index to start validation from.
     * @returns The validation result, including the validation errors recorded by the protocol blocks involved.
     */
    abstract validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult;
    
    /**
     * Checks if the validation result's error is a DatasetMismatchError, since it is a priority error.
     */
    protected containsDatasetMismatch(result: ValidationResult): boolean {
        return result.error instanceof DatasetMismatchError;
    }
}

/**
 * Represents an elementary block in the behaviour protocol, which corresponds to a single activity.
 * Also allows the use of a wildcard activity 'Any' which can match any activity in the sequence.
 */
export class ElementaryBlock extends ProtocolBlock{
    constructor(
        /** The allowed activity for this block. */
        public activity: Activity,
        /** If set, the activity may only be performed on this dataset. */
        public target?: DataSet,
    ){ super() }

    validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult {
        const identifier = services.flow.DatasetIdentifier;

        // start index past the end of the sequence -> no activity here; an empty `found` means end of pipeline
        if (startIndex > context.activitySequence.length) {
            return ValidationResult.failure(startIndex,
                new ProtocolViolation([this.activity], []));
        }
        
        const currentActivities = context.activitySequence[startIndex];

        const activityMatch = currentActivities?.some(activity => activity === this.activity);
        const anyMatch = currentActivities?.some(activity => activity === DSPipelineActivity.Any);
        
        if (activityMatch) {
            // check if only target dataset is used
            if (this.target){
                const currentCall = context.calls[startIndex];
                if (!currentCall) {
                    return ValidationResult.success(startIndex + 1);
                }
                const datasetResult = this.handleDatasetMismatch(
                    startIndex, currentCall, identifier,
                    currentActivities,
                    context.statements,
                );
                if (!datasetResult.isValid){
                    return datasetResult;
                }
            }
        }
        if (activityMatch || anyMatch) {
            this.notifyObservers(context, startIndex, services);
            return ValidationResult.success(startIndex + 1);
        }
        else {
            // currentActivities is undefined at the end of the sequence -> empty `found` means end of pipeline
            return ValidationResult.failure(startIndex, new ProtocolViolation(
                [this.activity],
                currentActivities ?? [],
            ));
        }
    }

    private notifyObservers(context: ValidationContext, startIndex: number, services: SafeDsServices): void {
        if (context.observers.length === 0) return;
        const currentCall = context.calls[startIndex];
        if (!currentCall) return;

        const callable = services.helpers.NodeMapper.callToCallable(currentCall);

        // a segment-inlined call operates on the (partition-agnostic) segment parameter, so its dataset is
        // ambiguous; attribute it to the partition of the segment call site's data argument instead.
        const segmentCallSite = context.segmentCallSites[startIndex];
        const identifier = services.flow.DatasetIdentifier;
        const detectedDataset = segmentCallSite
            ? identifier.datasetOfDataArguments(segmentCallSite, context.statements)
            : identifier.identifyDataset(currentCall, context.statements);

        for (const observer of context.observers) {
            observer.onElementaryMatch({
                phaseName: context.currentPhaseName,
                activity: this.activity,
                call: currentCall,
                callable,
                detectedDataset
            });
        }
    }

    private handleDatasetMismatch(
        startIndex: number,
        currentCall: SdsCall,
        identifier: SafeDsDatasetIdentifier,
        activities: Activity[] | undefined,
        statements: SdsStatement[],
    ) : ValidationResult {
        const identified = identifier.getDatasetOfCall(currentCall, statements);
        const actualDataset = identified?.dataset ?? DataSet.Fallback;
        if (actualDataset !== this.target) {
            return ValidationResult.failure(startIndex, 
                new DatasetMismatchError(this.target!, actualDataset, activities, identified?.reference));
        }
        return ValidationResult.success(startIndex + 1);
    }
}

/**
 * Represents a sequence of protocol blocks, where each block must be validated in order.
 */
export class SequenceBlock extends ProtocolBlock{
    constructor(
        public blocks: ProtocolBlock[],
    ){ super() }

    validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult {
        let updatedStartingPoint = startIndex;
        for (const block of this.blocks){
            const result = block.validate(context, updatedStartingPoint, services);
            if(!result.isValid){
                // propagate the inner error unchanged since it carries all needed details
                return result;
            }
            if (result.validatedIndex > updatedStartingPoint) {
                updatedStartingPoint = result.validatedIndex;
            }
        }
        return ValidationResult.success(updatedStartingPoint);
    }
}   

/**
 * Represents a repetition of a protocol block, where the block must be validated a certain number of times (between min and max).
 */
export class RepetitionBlock extends ProtocolBlock{
    constructor(
        public block: ProtocolBlock,
        public phaseName?: DSPipelinePhase,
        public min: number = 0,
        public max: number = Infinity,
        public exitDataset?: DataSet,
    ){ super() }

    validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult {
        const previousPhaseName = context.currentPhaseName;
        context.currentPhaseName = this.phaseName;

        try {
            let currentIndex = startIndex;

            // enforce the minimum required matches
            for (let counter = 0; counter < this.min; counter++) {
                const result = this.block.validate(context, currentIndex, services);
                if (!result.isValid) {
                    return this.enrichWithPhase(result);
                }
                currentIndex = result.validatedIndex;
            }

            // optionally match more times up to max
            for (let counter = this.min; counter < this.max; counter++) {
                // lookahead to check if the phase ended and the next phase started
                if (this.exitDataset && currentIndex < context.calls.length) {
                    const nextCall = context.calls[currentIndex];
                    const identifier = services.flow.DatasetIdentifier;
                    if (!nextCall) break;

                    if (identifier.identifyDataset(nextCall, context.statements) === this.exitDataset) break;
                }

                const result = this.block.validate(context, currentIndex, services);
                if (!result.isValid) {
                    if (this.containsDatasetMismatch(result)) {
                        return this.enrichWithPhase(result);
                    }
                    break;
                }
                // Empty-match safety invariant for a '*'-style repetition: never spin on an inner
                // block that succeeds without consuming input. The current protocol cannot trigger
                // this (every repeatable inner block advances on success — e.g. the FeatureSelection
                // group requires at least one selection), but the guard keeps the combinator safe for
                // any future optional-only inner block.
                if (result.validatedIndex === currentIndex) break;
                currentIndex = result.validatedIndex;
            }
            return ValidationResult.success(currentIndex);
        } finally {
            context.currentPhaseName = previousPhaseName;
        }
    }

    /**
     * Attaches this block's phase to the error of a failed inner result, so the message can name the
     * phase the violation occurred in. Only the innermost phase-carrying block sets it (withPhase
     * keeps an already-set phase), and only the two error kinds that need a phase are enriched.
     */
    private enrichWithPhase(result: ValidationResult): ValidationResult {
        if (result.error instanceof ProtocolViolation || result.error instanceof DatasetMismatchError) {
            return ValidationResult.failure(result.validatedIndex, result.error.withPhase(this.phaseName));
        }
        return result;
    }

}

/**
 * Represents an OR-alternative between multiple protocol blocks.
 */
export class AlternativeBlock extends ProtocolBlock{
    constructor(
        public blocks: ProtocolBlock[],
    ){ super() }

    validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult {
        const alternatives = this.blocks
            .filter(b => b instanceof ElementaryBlock)
            .map(b => (b as ElementaryBlock).activity);

        // the activities actually present at this position, used to name the offending activity in the
        // message when none of the alternatives match; an empty list (no activity here) means the pipeline ended
        const found = context.activitySequence[startIndex] ?? [];

        for (const block of this.blocks) {
            const result = block.validate(context, startIndex, services);
            if (result.isValid) return result;
            // a dataset mismatch in an alternative is a priority error: propagate it as-is
            if (this.containsDatasetMismatch(result)) return result;
        }
        return ValidationResult.failure(startIndex, new ProtocolViolation(alternatives, found));
    }
}


