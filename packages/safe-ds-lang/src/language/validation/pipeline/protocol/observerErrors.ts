import { DataSet } from '../../../flow/safe-ds-dataset-identifier.js';
import { ValidationError } from './protocolErrors.js';

// ---------------------------------------------------------------------------
// Observer Errors (cross-cutting consistency checks; span several phases, so no phase line)
// ---------------------------------------------------------------------------

export abstract class InconsistentTransformationError extends ValidationError {
    readonly severity = 'warning' as const;
}

export class InconsistentTransformationPresenceError extends InconsistentTransformationError {
    constructor(
        public readonly callableName: string,
        public readonly referenceDataset: DataSet,
        public readonly referenceCount: number,
        public readonly deviatingDataset: DataSet,
        public readonly deviatingCount: number
    ) { super(); }

    formatMessage(): string {
        return `Inconsistent preprocessing: '${this.callableName}' is ${this.describeCount(this.deviatingCount)} on ` +
            `'${this.deviatingDataset}' but ${this.describeCount(this.referenceCount)} on '${this.referenceDataset}'.\n` +
            `Fix: apply '${this.callableName}' the same number of times on every partition.`;
    }

    private describeCount(count: number): string {
        if (count === 0) return 'not applied';
        if (count === 1) return 'applied once';
        return `applied ${count} times`;
    }
}

export class InconsistentTransformationOrderError extends InconsistentTransformationError {
    constructor(
        public readonly referenceDataset: DataSet,
        public readonly referenceSequence: string[],
        public readonly deviatingDataset: DataSet,
        public readonly deviatingSequence: string[]
    ) { super(); }

    formatMessage(): string {
        const ref = this.referenceSequence.join(', ');
        const dev = this.deviatingSequence.join(', ');
        return `Inconsistent preprocessing order: '${this.deviatingDataset}' applies [${dev}] but ` +
            `'${this.referenceDataset}' applies [${ref}].\n` +
            `Fix: use the same order on every partition.`;
    }
}

export class InconsistentTransformationDataflowError extends InconsistentTransformationError {
    constructor(
        public readonly callableName: string,
        public readonly referenceDataset: DataSet,
        public readonly deviatingDataset: DataSet,
        public readonly referenceSuccessors: string[],
        public readonly deviatingSuccessors: string[]
    ) { super(); }

    formatMessage(): string {
        return `Inconsistent data flow: '${this.callableName}' feeds ${this.formatSuccessors(this.deviatingSuccessors)} ` +
            `on '${this.deviatingDataset}' but ${this.formatSuccessors(this.referenceSuccessors)} on '${this.referenceDataset}'.\n` +
            `Fix: route the output of '${this.callableName}' the same way on every partition.`;
    }

    private formatSuccessors(successors: string[]): string {
        if (successors.length === 0) return 'nothing';
        return successors.map(n => `'${n}'`).join(' and ');
    }
}

export class InconsistentTransformationArgumentsError extends InconsistentTransformationError {
    constructor(
        public readonly callableName: string,
        public readonly referenceDataset: DataSet,
        public readonly deviatingDataset: DataSet,
        public readonly parameterName: string,
        public readonly referenceValue: string,
        public readonly deviatingValue: string
    ) { super(); }

    formatMessage(): string {
        return `Inconsistent preprocessing arguments: '${this.callableName}' uses ` +
            `'${this.parameterName} = ${this.deviatingValue}' on '${this.deviatingDataset}' but ` +
            `'${this.parameterName} = ${this.referenceValue}' on '${this.referenceDataset}'.\n` +
            `Fix: use the same arguments on every partition.`;
    }
}
/**
 * Informational advice reported on every statement of the testing phase: the test set should be used
 * only once, for a single final estimate of the model's performance on unseen data. Repeatedly testing
 * (e.g. to tune the model) leaks the test set; hyperparameter optimization belongs on the validation set.
 */

export class SingleTestingAdvice extends ValidationError {
    readonly severity = 'info' as const;

    formatMessage(): string {
        return `Testing should only be done once, as a final estimate of the model's performance on unseen data.\n` +
            `Use the validation set for hyperparameter optimization instead.`;
    }
}
