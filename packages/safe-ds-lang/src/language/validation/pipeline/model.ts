import {
    ValidationResult, SequenceBlockFailedError,
    ElemBlockOobError, ElemBlockActivityMismatchError,
    AlternativeBlockNoMatchError, OrBlockNoMatchError,
    RepetitionBlockMinimumNotMetError,
    DatasetMismatchError,
} from './validationDataStructures.js'
import { ProtocolObserver } from './protocolObserver.js';
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsCall, SdsParameter, SdsExpression, SdsStatement } from '../../generated/ast.js';
import { SafeDsDatasetIdentifier } from '../../flow/safe-ds-dataset-identifier.js';

// DataSet for variable tracking
export enum DataSet {
    Original = 'Original',
    Training = 'Training',
    Test = 'Test',
    Validation = 'Validation',
}

export class Activity {
    constructor(
        public activityName: string,
    ){}
}

export class ValidationContext {
    public currentPhaseName: string | undefined = undefined;

    constructor(
        public activitySequence: Activity[][],
        public calls: SdsCall[],
        public paramArgMaps: Map<SdsParameter, SdsExpression>[],
        public statements: SdsStatement[],
        public observers: ProtocolObserver[] = [],
    ){}
}

/**
 * Abstract base class for protocol blocks.
 * Protocol Blocks can be elementary, sequences of blocks, repetitions of a block, or alternatives between blocks.
 * Using these Blocks a regular expression like structure can be created to define the valid sequences of activities in a pipeline.
 */
export abstract class ProtocolBlock {
    constructor(){}

    /**
     * Validates a sequence of activities against the protocol block.
     * @param sequence The sequence of activities to validate.
     * @param startIndex The index to start validation from.
     * @returns A tuple indicating if the validation was successful and the index of the next activity to validate.
     */
    abstract validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult;
    
    protected containsDatasetMismatch(result: ValidationResult): boolean {
        let current: ValidationResult | undefined = result;
        while (current) {
            if (current.error instanceof DatasetMismatchError) return true;
            current = current.baseError;
        }
        return false;
    }
}

/**
 * Represents an elementary block in the behaviour protocol, which corresponds to a single activity.
 * Also allows the use of a wildcard activity 'Any' which can match any activity in the sequence.
 */
export class ElementaryBlock extends ProtocolBlock{
    constructor(
        public activity: Activity,
        public target?: DataSet,
    ){ super() }

    validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult {
        const identifier = services.flow.DatasetIdentifier;

        if (startIndex > context.activitySequence.length) {
            return ValidationResult.failure(startIndex, new ElemBlockOobError());
        }
        
        const currentActivities = context.activitySequence[startIndex];

        const activityMatch = currentActivities?.some(activity => activity.activityName === this.activity.activityName);
        const anyMatch = currentActivities?.some(activity => activity.activityName === 'Any');
        
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
            return ValidationResult.failure(startIndex, new ElemBlockActivityMismatchError(
                new Activity(this.activity.activityName),
                currentActivities ?? [new Activity('EndOfPipeline')]
            ));
        }
    }

    private notifyObservers(context: ValidationContext, startIndex: number, services: SafeDsServices): void {
        if (context.observers.length === 0) return;
        const currentCall = context.calls[startIndex];
        if (!currentCall) return;

        const callable = services.helpers.NodeMapper.callToCallable(currentCall);
        const detectedDataset = this.detectDataset(currentCall, services.flow.DatasetIdentifier, context.statements);

        for (const observer of context.observers) {
            observer.onElementaryMatch({
                phaseName: context.currentPhaseName,
                activity: this.activity,
                call: currentCall,
                callable,
                detectedDataset,
                statements: context.statements,
            });
        }
    }

    private detectDataset(call: SdsCall, identifier: SafeDsDatasetIdentifier, statements: SdsStatement[]): DataSet | undefined {
        if (identifier.callReferencesTrainingSet(call, statements)) return DataSet.Training;
        if (identifier.callReferencesValidationSet(call, statements)) return DataSet.Validation;
        if (identifier.callReferencesTestSet(call, statements)) return DataSet.Test;
        return undefined;
    }

    // TODO: change fallback on original set, since it is wrong if the placeholder is unknown.
    private handleDatasetMismatch(
        startIndex: number,
        currentCall: SdsCall,
        identifier: SafeDsDatasetIdentifier,
        activities: Activity[] | undefined,
        statements: SdsStatement[],
    ) : ValidationResult {
        const isTraining = identifier.callReferencesTrainingSet(currentCall, statements);
        const isValidation = identifier.callReferencesValidationSet(currentCall, statements);
        const isTest = identifier.callReferencesTestSet(currentCall, statements);

        switch (this.target) {
            case DataSet.Training:
                if (!isTraining) {
                    const actual = isValidation ? DataSet.Validation : isTest ? DataSet.Test : DataSet.Original;
                    return ValidationResult.failure(startIndex, new DatasetMismatchError(this.target, actual, activities));
                }
                break;
            case DataSet.Validation:
                if (!isValidation) {
                    const actual = isTraining ? DataSet.Training : isTest ? DataSet.Test : DataSet.Original;
                    return ValidationResult.failure(startIndex, new DatasetMismatchError(this.target, actual, activities));
                }
                break;
            case DataSet.Test:
                if (!isTest) {
                    const actual = isTraining ? DataSet.Training : isValidation ? DataSet.Validation : DataSet.Original;
                    return ValidationResult.failure(startIndex, new DatasetMismatchError(this.target, actual, activities));
                }
                break;
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
                return ValidationResult.failure(result.validatedIndex, new SequenceBlockFailedError(), result);
            }
            // Identify Phase length
            /*
            else {
                const phaseEnd = context.calls[result.validatedIndex]
                if (block instanceof RepetitionBlock){
                    console.log("Phase: " + block.phaseName + "| until line:  " + phaseEnd?.$cstNode?.range.end.line)
                }
            }
            */
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
        public phaseName?: string,
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
                    return ValidationResult.failure(result.validatedIndex,
                        new RepetitionBlockMinimumNotMetError(this.min, counter, this.phaseName),
                        result);
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

                    const isNextOnExitSet = this.callUsesDataset(nextCall, this.exitDataset, identifier, context.statements);
                    if (isNextOnExitSet) break;
                }

                const result = this.block.validate(context, currentIndex, services);
                if (!result.isValid) {
                    if (this.containsDatasetMismatch(result)) {
                        return ValidationResult.failure(result.validatedIndex,
                            new RepetitionBlockMinimumNotMetError(this.min, counter, this.phaseName),
                            result);
                    }
                    break;
                }
                currentIndex = result.validatedIndex;
            }
            return ValidationResult.success(currentIndex);
        } finally {
            context.currentPhaseName = previousPhaseName;
        }
    }

    private callUsesDataset = (call: SdsCall, target: DataSet, identifier: SafeDsDatasetIdentifier, statements: SdsStatement[]): boolean => {
        switch(target) {
            case DataSet.Training:   return identifier.callReferencesTrainingSet(call, statements);
            case DataSet.Validation: return identifier.callReferencesValidationSet(call, statements);
            case DataSet.Test:       return identifier.callReferencesTestSet(call, statements);
            default:                 return false;
        }
    }
}

/**
 * Represents an alternative between multiple protocol blocks, with the relation being either 'or' or 'xor'.
 */
export class AlternativeBlock extends ProtocolBlock{
    constructor(
        public blocks: ProtocolBlock[],
        public relation: 'or' | 'xor',
    ){ super() }

    validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult {
        const alternatives = this.blocks
            .filter(b => b instanceof ElementaryBlock)
            .map(b => (b as ElementaryBlock).activity);
        
        
        switch(this.relation){
            case 'or': {
                for (const block of this.blocks) {
                    const result = block.validate(context, startIndex, services);
                    if (result.isValid) return result;
                    if (this.containsDatasetMismatch(result)) {
                        return ValidationResult.failure(startIndex, new OrBlockNoMatchError(alternatives), result);
                    }
                }
                return ValidationResult.failure(startIndex, new OrBlockNoMatchError(alternatives));
            }

            // Unfinished, as it is currently not used in the protocol definition. Should be implemented if XOR relation is needed in the future.
            case 'xor': {}
        }
        return ValidationResult.failure(startIndex, new AlternativeBlockNoMatchError(alternatives));
    }
}


