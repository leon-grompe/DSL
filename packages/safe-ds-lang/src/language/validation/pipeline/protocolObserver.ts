import { isSdsClass, isSdsFunction, SdsCall, SdsCallable } from '../../generated/ast.js';
import { Activity, DataSet } from './model.js';
import { InconsistentTransformationError, ValidationError } from './validationDataStructures.js';

export interface MatchInfo {
    phaseName: string | undefined;
    activity: Activity;
    call: SdsCall;
    /** The resolved callable definition. Two calls to the same function share the same reference. */
    callable: SdsCallable | undefined;
    /** Dataset the call was resolved to operate on, or undefined if unknown. */
    detectedDataset: DataSet | undefined;
}

export interface ObserverError {
    error: ValidationError;
    call: SdsCall;
}

export interface ProtocolObserver {
    /** Called on every successful ElementaryBlock match during protocol validation. */
    onElementaryMatch(info: MatchInfo): void;
    /** Called once after the full protocol validates successfully. Returns any additional errors found. */
    finalize(): ObserverError[];
}

/**
 * Observes ElementaryBlock matches during protocol validation and checks that the same
 * callables are applied to all dataset types (Training, Test, Validation) within the
 * tracked phases. Reports a warning for any callable that is applied to one dataset
 * but missing from another.
 */
export class ConsistentTransformationObserver implements ProtocolObserver {
    // dataset → callable (by reference) → representative call
    private readonly ops = new Map<DataSet, Map<SdsCallable, SdsCall>>();

    constructor(
        private readonly trackedPhases: string[],
        private readonly excludedActivities: string[] = [],
    ) {}

    onElementaryMatch(info: MatchInfo): void {
        if (!info.phaseName || !this.trackedPhases.includes(info.phaseName)) return;
        if (this.excludedActivities.includes(info.activity.activityName)) return;
        if (!info.callable || !info.detectedDataset) return;
        if (info.detectedDataset === DataSet.Original) return;
        if (info.activity.activityName === 'Any') return;

        let datasetOps = this.ops.get(info.detectedDataset);
        if (!datasetOps) {
            datasetOps = new Map();
            this.ops.set(info.detectedDataset, datasetOps);
        }

        // keep the first occurrence of each callable per dataset as the representative call
        if (!datasetOps.has(info.callable)) {
            datasetOps.set(info.callable, info.call);
        }
    }

    finalize(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.ops.keys()];
        if (usedDatasets.length < 2) return errors;

        // union of all callables seen across all datasets
        const allCallables = new Set<SdsCallable>();
        for (const datasetOps of this.ops.values()) {
            for (const callable of datasetOps.keys()) allCallables.add(callable);
        }

        for (const callable of allCallables) {
            const presentOn = usedDatasets.filter(d => this.ops.get(d)?.has(callable));
            const missingFrom = usedDatasets.filter(d => !this.ops.get(d)?.has(callable));

            if (missingFrom.length === 0) continue;

            const callableName = isSdsFunction(callable) || isSdsClass(callable)
                ? callable.name
                : callable.$type;

            const representativeCall = this.ops.get(presentOn[0]!)!.get(callable)!;
            errors.push({
                error: new InconsistentTransformationError(callableName, presentOn, missingFrom),
                call: representativeCall,
            });
        }

        return errors;
    }
}