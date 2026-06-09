import {
    isSdsAssignment, isSdsClass, isSdsFunction, isSdsPlaceholder, isSdsReference,
    SdsCall, SdsCallable, SdsStatement,
} from '../../generated/ast.js';
import { DataSet } from '../../flow/safe-ds-dataset-identifier.js';
import { Activity } from './model.js';
import { DSPipelineActivity } from './dsPipelineActivity.js';
import {
    InconsistentTransformationPresenceError,
    InconsistentTransformationOrderError,
    InconsistentTransformationDataflowError,
    ValidationError,
} from './validationDataStructures.js';

export interface MatchInfo {
    phaseName: string | undefined;
    activity: Activity;
    call: SdsCall;
    /** The resolved callable definition. Two calls to the same function share the same reference. */
    callable: SdsCallable | undefined;
    /** Dataset the call was resolved to operate on, or undefined if unknown. */
    detectedDataset: DataSet | undefined;
    /** All statements in the pipeline, used for dataflow predecessor analysis. */
    statements: SdsStatement[];
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

type ObservedEntry = { callable: SdsCallable; call: SdsCall };

/**
 * Observes ElementaryBlock matches during protocol validation and checks three levels
 * of consistency for callables applied to different dataset partitions within the
 * tracked phases:
 *  1. Presence  — the same callables are applied to all datasets
 *  2. Order     — the callables are applied in the same order on all datasets
 *  3. Dataflow  — each callable receives input from the same predecessor (or raw data) on all datasets
 */
export class ConsistentTransformationObserver implements ProtocolObserver {
    // dataset → ordered unique callables (first occurrence)
    private readonly ops = new Map<DataSet, ObservedEntry[]>();
    private statements: SdsStatement[] = [];

    constructor(
        private readonly trackedPhases: string[],
        private readonly excludedActivities: Activity[] = [],
    ) {}

    onElementaryMatch(info: MatchInfo): void {
        if (!info.phaseName || !this.trackedPhases.includes(info.phaseName)) return;
        if (this.excludedActivities.includes(info.activity)) return;
        if (!info.callable || !info.detectedDataset) return;
        if (info.detectedDataset === DataSet.Original) return;
        if (info.activity === DSPipelineActivity.Any) return;

        // Store statements reference (same across all calls in a pipeline)
        if (this.statements.length === 0) this.statements = info.statements;

        let datasetOps = this.ops.get(info.detectedDataset);
        if (!datasetOps) {
            datasetOps = [];
            this.ops.set(info.detectedDataset, datasetOps);
        }

        // Keep only the first occurrence of each callable per dataset (preserving order)
        if (!datasetOps.some(e => e.callable === info.callable)) {
            datasetOps.push({ callable: info.callable, call: info.call });
        }
    }

    finalize(): ObserverError[] {
        return [
            ...this.checkPresence(),
            ...this.checkOrder(),
            ...this.checkDataflow(),
        ];
    }

    // ---------------------------------------------------------------------------
    // Check 1: same callables on all datasets
    // ---------------------------------------------------------------------------

    private checkPresence(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.ops.keys()];
        if (usedDatasets.length < 2) return errors;

        const allCallables = new Set<SdsCallable>();
        for (const entries of this.ops.values()) {
            for (const { callable } of entries) allCallables.add(callable);
        }

        for (const callable of allCallables) {
            const presentOn  = usedDatasets.filter(d =>  this.ops.get(d)?.some(e => e.callable === callable));
            const missingFrom = usedDatasets.filter(d => !this.ops.get(d)?.some(e => e.callable === callable));
            if (missingFrom.length === 0) continue;

            const representativeCall = this.ops.get(presentOn[0]!)!.find(e => e.callable === callable)!.call;
            errors.push({
                error: new InconsistentTransformationPresenceError(
                    this.callableName(callable), presentOn, missingFrom,
                ),
                call: representativeCall,
            });
        }
        return errors;
    }

    // ---------------------------------------------------------------------------
    // Check 2: same order of callables across datasets
    // ---------------------------------------------------------------------------

    private checkOrder(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.ops.keys()];
        if (usedDatasets.length < 2) return errors;

        const referenceDataset = usedDatasets.includes(DataSet.Training)
            ? DataSet.Training : usedDatasets[0]!;
        const referenceEntries = this.ops.get(referenceDataset)!;

        for (const dataset of usedDatasets) {
            if (dataset === referenceDataset) continue;
            const datasetEntries = this.ops.get(dataset)!;

            // Only compare sequences of equal length — differing lengths are a presence issue
            if (datasetEntries.length !== referenceEntries.length) continue;
            if (referenceEntries.every((e, i) => e.callable === datasetEntries[i]!.callable)) continue;

            const refNames = referenceEntries.map(e => this.callableName(e.callable));
            const devNames = datasetEntries.map(e => this.callableName(e.callable));
            const firstDiff = datasetEntries.find((e, i) => e.callable !== referenceEntries[i]?.callable)!;

            errors.push({
                error: new InconsistentTransformationOrderError(referenceDataset, refNames, dataset, devNames),
                call: firstDiff.call,
            });
        }
        return errors;
    }

    // ---------------------------------------------------------------------------
    // Check 3: same dataflow (each callable receives input from the same predecessor)
    // ---------------------------------------------------------------------------

    private checkDataflow(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.ops.keys()];
        if (usedDatasets.length < 2) return errors;

        const referenceDataset = usedDatasets.includes(DataSet.Training)
            ? DataSet.Training : usedDatasets[0]!;

        // Build global map: tracked SdsCall → its assigned placeholder
        const callToPlaceholder = this.buildCallToPlaceholderMap();

        // Build per-dataset: placeholder → callable that produced it
        const datasetPredecessorMap = new Map<DataSet, Map<object, SdsCallable>>();
        for (const [dataset, entries] of this.ops) {
            const map = new Map<object, SdsCallable>();
            for (const { callable, call } of entries) {
                const placeholder = callToPlaceholder.get(call);
                if (placeholder) map.set(placeholder, callable);
            }
            datasetPredecessorMap.set(dataset, map);
        }

        const predecessorOf = (dataset: DataSet, call: SdsCall): SdsCallable | undefined => {
            const predecessorMap = datasetPredecessorMap.get(dataset);
            if (!predecessorMap) return undefined;
            for (const arg of call.argumentList.arguments) {
                if (isSdsReference(arg.value)) {
                    const ref = arg.value.target.ref;
                    if (ref && predecessorMap.has(ref)) return predecessorMap.get(ref);
                }
            }
            return undefined;
        };

        const referenceEntries = this.ops.get(referenceDataset)!;

        for (const dataset of usedDatasets) {
            if (dataset === referenceDataset) continue;

            for (const { callable, call } of this.ops.get(dataset)!) {
                const refEntry = referenceEntries.find(e => e.callable === callable);
                if (!refEntry) continue;

                const refPred = predecessorOf(referenceDataset, refEntry.call);
                const devPred = predecessorOf(dataset, call);
                if (refPred === devPred) continue;

                errors.push({
                    error: new InconsistentTransformationDataflowError(
                        this.callableName(callable),
                        referenceDataset, refPred ? this.callableName(refPred) : undefined,
                        dataset,         devPred ? this.callableName(devPred) : undefined,
                    ),
                    call,
                });
            }
        }
        return errors;
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private callableName(callable: SdsCallable): string {
        return isSdsFunction(callable) || isSdsClass(callable) ? callable.name : callable.$type;
    }

    /** Builds a map from each tracked SdsCall to the placeholder it was assigned to in the statements. */
    private buildCallToPlaceholderMap(): Map<SdsCall, object> {
        const allTrackedCalls = new Set<SdsCall>();
        for (const entries of this.ops.values()) {
            for (const { call } of entries) allTrackedCalls.add(call);
        }

        // Build: expression node → first assigned placeholder (from all statements)
        const exprToPlaceholder = new Map<object, object>();
        for (const stmt of this.statements) {
            if (!isSdsAssignment(stmt)) continue;
            const expr = stmt.expression;
            const firstAssignee = stmt.assigneeList?.assignees[0];
            if (expr && firstAssignee && isSdsPlaceholder(firstAssignee)) {
                exprToPlaceholder.set(expr, firstAssignee);
            }
        }

        // Keep only entries for tracked calls
        const result = new Map<SdsCall, object>();
        for (const call of allTrackedCalls) {
            const placeholder = exprToPlaceholder.get(call);
            if (placeholder) result.set(call, placeholder);
        }
        return result;
    }
}
