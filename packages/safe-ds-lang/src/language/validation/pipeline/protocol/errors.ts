import { DataSet } from '../../../flow/safe-ds-dataset-identifier.js';
import { SdsReference } from '../../../generated/ast.js';
import { guidanceForPhase, nextPhaseOf } from './dsPipelinePhase.js';
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
 * Abstract base class for validation errors. Each error type implements `formatMessage` to provide a
 * user-friendly message. `severity` corresponds to langium's severity; `isPriority` lets a critical
 * error (e.g. a dataset mismatch) be reported on its own.
 */
export abstract class ValidationError {
    /** The severity of the error. Corresponds to langium's severity. */
    abstract readonly severity: 'error' | 'warning' | 'info';
    /** Priority errors are reported on their own, ahead of any structural violation. */
    readonly isPriority: boolean = false;
    
    /** Returns the user-facing message for this error. `phase` is the detected phase, or '' if unknown. */
    abstract formatMessage(phase: string): string;
}

/**
 * The single structural protocol violation: the activity at this position is not one the protocol allows
 * here, or a required activity is missing because the pipeline ended. Carries the allowed activities
 * (`expected`), what was actually found (`found`), and the phase it occurred in (`phase`, attached by
 * the enclosing RepetitionBlock).
 */
export class ProtocolViolation extends ValidationError {
    constructor(
        /** The activities the protocol allows at this position. */
        public expected: Activity[],
        /** The activities actually present here; an empty list means the pipeline ended before this position. */
        public found: Activity[],
        public phase?: string,
    ) { super(); }
    readonly severity = 'warning' as const;

    /** Returns a copy carrying `phase`, unless a (more specific, inner) phase is already set. */
    withPhase(phase: string | undefined): ProtocolViolation {
        if (this.phase || !phase) return this;
        return new ProtocolViolation(this.expected, this.found, phase);
    }

    /**
     * Generates a Message in the following format:
     *   Current phase: '<phase>'. <what is wrong>
     *   Allowed Activites: '<...>'.
     *   Next phase: '<...>'. (only for a wrong activity, not a missing one)
     *   Fix: <short info about current phase>
     */
    formatMessage(phase: string): string {
        const here = phase ? `Current phase: '${phase}'. ` : '';
        const lines: string[] = [];

        if (ranPastEnd(this.found)) {
            // a required activity is missing: state what is expected here, not what comes next
            lines.push(`${here}A required activity is missing before the pipeline ends.`);
            lines.push(`Allowed Activities: ${describeAllowed(this.expected)}.`);
        } else {
            lines.push(`${here}Activity ${describeFound(this.found)} is not allowed here.`);
            lines.push(`Allowed Activities: ${describeAllowed(this.expected)}.`);
            const next = nextPhaseOf(phase);
            if (next) lines.push(`Next phase: '${next}'.`);
        }

        const hint = guidanceForPhase(phase);
        if (hint) lines.push(`Fix: ${hint}`);
        return lines.join('\n');
    }
}

/**
 * A dataset-bound activity (e.g. a training-only post-split step, or evaluation on the validation set)
 * runs on the wrong partition, risking data leakage. Priority error with an `error` severity and a
 * quick-fix (driven by `wrongReference`). `phase` is attached by the enclosing RepetitionBlock.
 */
export class DatasetMismatchError extends ValidationError {
    constructor(
        public expected: DataSet,
        public found: DataSet,
        public activities?: Activity[],
        public wrongReference?: SdsReference,
        public phase?: string,
    ) { super(); }
    readonly severity = 'error' as const;
    override readonly isPriority = true;

    /** Returns a copy carrying `phase`, unless one is already set (mirrors ProtocolViolation). */
    withPhase(phase: string | undefined): DatasetMismatchError {
        if (this.phase || !phase) return this;
        return new DatasetMismatchError(this.expected, this.found, this.activities, this.wrongReference, phase);
    }

    formatMessage(phase: string): string {
        const resolvedPhase = this.phase ?? phase;
        const here = resolvedPhase ? `Current phase: '${resolvedPhase}'. ` : '';
        const matched = getActivityOnPhaseMatch(this.activities ?? [], resolvedPhase);
        const activity = matched.length ? `'${matched.join("', '")}'` : 'this activity';

        const lines = [
            `${here}Activity ${activity} may only run on '${this.expected}', not '${this.found}' (risks data leakage).`,
        ];
        const next = nextPhaseOf(resolvedPhase);
        if (next) lines.push(`Next phase: '${next}'.`);
        lines.push(`Fix: use '${this.expected}' here (a quick fix is available to swap the dataset).`);
        return lines.join('\n');
    }
}

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
        public readonly deviatingCount: number,
    ) { super(); }

    formatMessage(_phase: string): string {
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
        public readonly deviatingSequence: string[],
    ) { super(); }

    formatMessage(_phase: string): string {
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
        public readonly deviatingSuccessors: string[],
    ) { super(); }

    formatMessage(_phase: string): string {
        return `Inconsistent data flow: '${this.callableName}' feeds ${this.formatSuccessors(this.deviatingSuccessors)} ` +
               `on '${this.deviatingDataset}' but ${this.formatSuccessors(this.referenceSuccessors)} on '${this.referenceDataset}'.\n` +
               `Fix: route the output of '${this.callableName}' the same way on every partition.`;
    }

    private formatSuccessors(successors: string[]): string {
        if (successors.length === 0) return 'nothing';
        return successors.map(n => `'${n}'`).join(' and ');
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

/** Renders an activity as its full 'Phase - Type' name, e.g. "DataPartitioning - Split". */
const fullActivityName = (activity: Activity): string => {
    return (activity as string).replace('Q', ' - ');
}

/**
 * True when the validator ran past the last call, i.e. there was no activity at the checked position.
 * A real position always holds at least one activity (an un-annotated call yields `[Any]`), so an
 * empty `found` list is the sentinel for "the pipeline ended here".
 */
const ranPastEnd = (found: Activity[]): boolean => {
    return found.length === 0;
}

/** Renders the activities found at a position, e.g. "'Modeling - Creating'"; an empty list means the end of the pipeline. */
const describeFound = (found: Activity[]): string => {
    const unique = [...new Set(found)];
    if (unique.length === 0) return 'the end of the pipeline';
    return unique.map((activity) => `'${fullActivityName(activity)}'`).join(', ');
};

/** Renders the allowed activities as a quoted, type-only list, e.g. "'Split'" or "'Exploration', 'Augmentation'". */
const describeAllowed = (expected: Activity[]): string => {
    return expected.map((activity) => `'${activityTypeOf(activity)}'`).join(', ');
}