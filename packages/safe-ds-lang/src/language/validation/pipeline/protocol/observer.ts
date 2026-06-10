import { AstUtils } from 'langium';
import {
    isSdsAssignment, isSdsClass, isSdsFunction, isSdsPlaceholder, isSdsReference,
    SdsCall, SdsCallable, SdsStatement,
} from '../../../generated/ast.js';
import { DataSet } from '../../../flow/safe-ds-dataset-identifier.js';
import { Activity } from './model.js';
import { DSPipelineActivity } from './dsPipelineActivity.js';
import {
    InconsistentTransformationPresenceError,
    InconsistentTransformationOrderError,
    InconsistentTransformationDataflowError,
    ValidationError,
} from './errors.js';

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
    /** The outermost pipeline-level segment call that contains this call, if any. */
    segmentCallSite?: SdsCall;
}

export interface ObserverError {
    error: ValidationError;
    call: SdsCall;
}

export interface ProtocolObserver {
    /** Called on every successful ElementaryBlock match during protocol validation. */
    onElementaryMatch(info: MatchInfo): void;
    /** Called once after the full protocol is validated. Returns any additional errors found. */
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
    // dataset -> ordered unique callables (first occurrence)
    private readonly ops = new Map<DataSet, ObservedEntry[]>();
    private statements: SdsStatement[] = [];

    constructor(
        private readonly trackedPhases: string[],
        private readonly excludedActivities: Activity[] = [],
    ) {}

    onElementaryMatch(info: MatchInfo): void {
        if (!info.phaseName || !info.callable || !info.detectedDataset) return;
        if (!this.trackedPhases.includes(info.phaseName)) return;
        if (this.excludedActivities.includes(info.activity)) return;
        if (info.detectedDataset === DataSet.Original) return;
        if (info.activity === DSPipelineActivity.Any) return;

        // normalize the callable to skip 'fit' and treat 'transform' and 'fitAndTransform' the same
        const normalizedCallable = this.normalizeCallable(info.callable);
        if (!normalizedCallable) return;

        // store pipeline statements for future dataflow check in finalize()
        if (this.statements.length === 0) this.statements = info.statements;
        
        // record the callable for the detected dataset
        this.recordEntry(info.detectedDataset, normalizedCallable, info.call);
    }

    /**
     * Records an observed callable for a dataset.
     * Currently only tracks first occurences of callables.
     */
    private recordEntry(dataset: DataSet, callable: SdsCallable, call: SdsCall): void {
        let datasetOps = this.ops.get(dataset);
        if (!datasetOps) { datasetOps = []; this.ops.set(dataset, datasetOps); }
        if (!datasetOps.some(e => e.callable === callable)) {
            datasetOps.push({ callable, call });
        }
    }

    /**
     * Normalizes callables for consistency checks by ignoring certain call types or replacing them with their underlying class.
     */
    private normalizeCallable(callable: SdsCallable): SdsCallable | null {
        if (!isSdsFunction(callable)) return callable;
        // ignore 'fit'
        if (callable.name === 'fit') return null;
        
        // if 'fitAndTransform' or 'transform', consider the underlying class as callable
        // this way these calls are treated the same for validation and test set
        if (callable.name === 'fitAndTransform' || callable.name === 'transform') {
            return AstUtils.getContainerOfType(callable, isSdsClass) ?? callable;
        }
        return callable;
    }

    /**
     * Finalizes the observer by checking the recorded callables for presence, order and dataflow consistency.
     */
    finalize(): ObserverError[] {
        return [
            ...this.checkPresence(),
            ...this.checkOrder(),
            ...this.checkDataflow(),
        ];
    }


    /**
     * Checks for consistent presence of callables across datasets.
     */
    private checkPresence(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.ops.keys()];
        if (usedDatasets.length < 2) return errors;

        // build the union of all callables observed across datasets
        const allCallables = new Set<SdsCallable>();
        for (const entries of this.ops.values()) {
            for (const { callable } of entries) allCallables.add(callable);
        }

        // for each callable, check if it is present on all datasets and collect errors for missing presence
        for (const callable of allCallables) {
            const presentOn  = usedDatasets.filter(d =>  this.ops.get(d)?.some(e => e.callable === callable));
            const missingFrom = usedDatasets.filter(d => !this.ops.get(d)?.some(e => e.callable === callable));
            // callable appears on all datasets -> no presence inconsistency
            if (missingFrom.length === 0) continue;

            // pick a representative call from one of the datasets where the callable is present to report the error on
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

    /**
     * Checks for consistent order of callables across datasets, assuming they are all present.
     */
    private checkOrder(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.ops.keys()];
        if (usedDatasets.length < 2) return errors;

        // choose reference dataset for order comparison
        const referenceDataset = usedDatasets.includes(DataSet.Training)
            ? DataSet.Training : usedDatasets[0]!;
        const referenceEntries = this.ops.get(referenceDataset)!;

        for (const dataset of usedDatasets) {
            if (dataset === referenceDataset) continue;
            const datasetEntries = this.ops.get(dataset)!;

            // length mismatch is caught by presence check
            if (datasetEntries.length !== referenceEntries.length) continue;
            // if all callables match at each index, sequences are consistent
            if (referenceEntries.every((e, i) => e.callable === datasetEntries[i]!.callable)) continue;

            // build readable callable names for error message
            const refNames = referenceEntries.map(e => this.callableName(e.callable));
            const devNames = datasetEntries.map(e => this.callableName(e.callable));
            
            // find the first deviating callable to report the error on
            const firstDiff = datasetEntries.find((e, i) => e.callable !== referenceEntries[i]?.callable)!;

            errors.push({
                error: new InconsistentTransformationOrderError(referenceDataset, refNames, dataset, devNames),
                call: firstDiff.call,
            });
        }
        return errors;
    }

    /**
     * Checks for consistent dataflow (each callable receives input from the same predecessor).
     */
    private checkDataflow(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.ops.keys()];
        if (usedDatasets.length < 2) return errors;

        // TODO: IMPLEMENTATION

        return errors;
    }


    /**
     * Helper to get the callable name.
     */
    private callableName(callable: SdsCallable): string {
        return isSdsFunction(callable) || isSdsClass(callable) ? callable.name : callable.$type;
    }

}
