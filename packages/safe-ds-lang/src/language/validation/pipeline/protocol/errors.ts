import { DataSet } from '../../../flow/safe-ds-dataset-identifier.js';
import { Activity } from './model.js';
import { activityTypeOf, phaseOf } from './dsPipelineActivity.js';

export interface ValidationMessage {
    message: string;
    severity: 'error' | 'warning' | 'info';
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Abstract base class for validation errors. Each error type should extend this 
 * class and implement the formatMessage method to provide a user-friendly error 
 * message. The severity property indicates the kind of validation , and the 
 * isPriority flag can be used to short-circuit further error processing when a 
 * critical issue is detected (e.g., dataset mismatch).
 */
export abstract class ValidationError {
    /** The severity of the error. Corresponds to langiums severity. */
    abstract readonly severity: 'error' | 'warning' | 'info';
    /** Priority errors short-circuit message generation (no further errors are processed). */
    readonly isPriority: boolean = false;
    
    /** Returns a message fragment, or null if this error contributes nothing useful. */
    abstract formatMessage(phase: string): string | null;
}

/**
 * This error occurs when a SequenceBlock fails to validate.
 * Usually does not contain useful information by itself.
 */
export class SequenceBlockFailedError extends ValidationError {
    readonly severity = 'warning' as const;
    formatMessage(_phase: string): null { return null; }
}

/**
 * This error occurs when an ElementaryBlock tries to validate an activity that 
 * is out of bounds (i.e., the activity sequence has already ended).
 */
export class ElemBlockOobError extends ValidationError {
    readonly severity = 'warning' as const;
    formatMessage(_phase: string): string { return 'Pipeline ended unexpectedly.'; }
}

/**
 * This error occurs when an ElementaryBlock tries to validate an activity that 
 * does not match the expected one. The error message lists the expected activity
 * and the found activities.
 */
export class ElemBlockActivityMismatchError extends ValidationError {
    constructor(public expected: Activity, public found: Activity[]) { super(); }
    readonly severity = 'warning' as const;
    formatMessage(_phase: string): string {
        const foundNames = [...new Set(this.found
            .map(a => `'${(a as string).replace('Q', ' - ')}'`))]
            .join(', ');
        return `Expected '${(this.expected as string).replace('Q', ' - ')}' but found ${foundNames}.`;
    }
}


/**
 * This error occurs when an OrBlock fails to find any matching activity in any
 * of its alternatives. The error message lists the expected activities across 
 * all alternatives for the current phase.
 */
export class OrBlockNoMatchError extends ValidationError {
    constructor(public alternatives: Activity[]) { super(); }
    readonly severity = 'warning' as const;
    formatMessage(phase: string): string {
        const context = phase !== '' ? `phase ${phase}` : 'current phase';
        const names = this.alternatives.map(a => `'${activityTypeOf(a)}'`).join(', ');
        return `Expected one of the following activities during ${context}: ${names}.`;
    }
}

/**
 * This error occurs when a RepetitionBlock does not meet its minimum occurrence 
 * requirement. If 'min' is greater than 1, the error message specifies how many 
 * occurrences were expected and found.
 */
export class RepetitionBlockMinimumNotMetError extends ValidationError {
    constructor(public min: number, public actual: number, public phaseName?: string) { super(); }
    readonly severity = 'warning' as const;
    formatMessage(phase: string): string {
        if (this.min > 1 && this.actual > 1) {
            return `Phase ${phase} requires at least ${this.min} occurrences but found ${this.actual}.`;
        }
        return `Detected activity is not allowed during phase ${phase}.`;
    }
}

/**
 * This error occurs when an activity is performed on a dataset that does not match 
 * the expected dataset for the current phase. The error message specifies the expected
 * and found datasets, and if available, the activities that caused the mismatch.
 */
export class DatasetMismatchError extends ValidationError {
    constructor(public expected: DataSet, public found: DataSet, public activities?: Activity[]) { super(); }
    readonly severity = 'error' as const;
    override readonly isPriority = true;
    formatMessage(phase: string): string {
        const formattedActivities = getActivityOnPhaseMatch(this.activities ?? [], phase).join(', ');
        return `Dataset mismatch: During phase ${phase} the activity '${formattedActivities}' may only be ` +
               `performed on the '${this.expected}' dataset, not the '${this.found}' dataset.`;
    }
}

export class InconsistentTransformationPresenceError extends ValidationError {
    constructor(
        public readonly callableName: string,
        public readonly presentOn: DataSet[],
        public readonly missingFrom: DataSet[],
    ) { super(); }

    readonly severity = 'warning' as const;

    formatMessage(_phase: string): string {
        const presentStr = this.presentOn.map(d => `'${d}'`).join(' and ');
        const missingStr = this.missingFrom.map(d => `'${d}'`).join(' and ');
        return `'${this.callableName}' is applied to the ${presentStr} dataset but not to ${missingStr}.`;
    }
}

export class InconsistentTransformationOrderError extends ValidationError {
    constructor(
        public readonly referenceDataset: DataSet,
        public readonly referenceSequence: string[],
        public readonly deviatingDataset: DataSet,
        public readonly deviatingSequence: string[],
    ) { super(); }

    readonly severity = 'warning' as const;

    formatMessage(_phase: string): string {
        const ref = this.referenceSequence.map(n => `'${n}'`).join(', ');
        const dev = this.deviatingSequence.map(n => `'${n}'`).join(', ');
        return `Transformation order differs: ${this.referenceDataset} applies [${ref}] but ` +
               `${this.deviatingDataset} applies [${dev}]. Consider using the same order for readability.`;
    }
}

export class InconsistentTransformationDataflowError extends ValidationError {
    constructor(
        public readonly callableName: string,
        public readonly referenceDataset: DataSet,
        public readonly referencePredecessor: string | undefined,
        public readonly deviatingDataset: DataSet,
        public readonly deviatingPredecessor: string | undefined,
    ) { super(); }

    readonly severity = 'warning' as const;

    formatMessage(_phase: string): string {
        const refInput = this.referencePredecessor ? `the output of '${this.referencePredecessor}'` : 'raw data';
        const devInput = this.deviatingPredecessor ? `the output of '${this.deviatingPredecessor}'` : 'raw data';
        return `Dataflow mismatch for '${this.callableName}': receives ${devInput} on the ` +
               `${this.deviatingDataset} dataset but ${refInput} on the ${this.referenceDataset} dataset. ` +
               `Ensure data flows consistently across all partitions.`;
    }
}

// ---------------------------------------------------------------------------
// ValidationResult
// ---------------------------------------------------------------------------

export class ValidationResult {
    public readonly isValid: boolean;
    public readonly validatedIndex: number;
    public readonly errors: ValidationError[];

    private constructor(isValid: boolean, validatedIndex: number, errors: ValidationError[]) {
        this.isValid = isValid;
        this.validatedIndex = validatedIndex;
        this.errors = errors;
    }

    static success(validatedIndex: number): ValidationResult {
        return new ValidationResult(true, validatedIndex, []);
    }

    static failure(validatedIndex: number, error?: ValidationError, base?: ValidationResult): ValidationResult {
        const errors = [...(error ? [error] : []), ...(base?.errors ?? [])];
        return new ValidationResult(false, validatedIndex, errors);
    }

    generateValidationMessage(): ValidationMessage {
        // resolve phase name from the first repetition-block error that carries one
        let phase = '';
        for (const error of this.errors) {
            if (error instanceof RepetitionBlockMinimumNotMetError && error.phaseName) {
                phase = `'${error.phaseName}'`;
                break;
            }
        }

        // priority errors (e.g. dataset mismatch) short-circuit the rest
        const priorityError = this.errors.find(e => e.isPriority);
        if (priorityError) {
            return { message: priorityError.formatMessage(phase) ?? '', severity: priorityError.severity };
        }

        const messages = this.errors
            .map(e => e.formatMessage(phase))
            .filter((m): m is string => m !== null);

        return { message: messages.join('\n'), severity: 'warning' };
    }
}

// ---------------------------------------------------------------------------
// String helpers (internal — used by error classes above)
// ---------------------------------------------------------------------------

const getActivityOnPhaseMatch = (activities: Activity[], phaseName: string): string[] => {
    const cleanPhaseName = phaseName.replaceAll("'", '').trim();
    return activities
        .filter(a => phaseOf(a) === cleanPhaseName)
        .map(a => activityTypeOf(a));
};
