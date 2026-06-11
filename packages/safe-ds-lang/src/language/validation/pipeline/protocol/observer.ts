import { AstNode, AstUtils } from 'langium';
import {
    isSdsAssignment, isSdsCall, isSdsClass, isSdsFunction, isSdsMemberAccess, isSdsPlaceholder, isSdsReference,
    SdsCall, SdsCallable, SdsClass, SdsPlaceholder, SdsStatement,
} from '../../../generated/ast.js';
import { ClassType } from '../../../typing/model.js';
import { DataSet } from '../../../flow/safe-ds-dataset-identifier.js';
import { SafeDsServices } from '../../../safe-ds-module.js';
import { getAssignees } from '../../../helpers/nodeProperties.js';
import { Activity } from './model.js';
import { DSPipelineActivity } from './dsPipelineActivity.js';
import {
    InconsistentTransformationPresenceError,
    InconsistentTransformationOrderError,
    InconsistentTransformationDataflowError,
    ValidationError,
} from './errors.js';

/**
 * Provides information to the observer that it uses for checks. 
 */
export interface MatchInfo {
    /** Name of the phase that was detected at the point of the match. */
    phaseName: string | undefined;
    /** Activity that was detected at the point of the match. */
    activity: Activity;
    /** Call the match was found on. */
    call: SdsCall;
    /** The resolved callable definition. Two calls to the same function share the same reference. */
    callable: SdsCallable | undefined;
    /** Dataset the call was resolved to operate on, or undefined if unknown. */
    detectedDataset: DataSet | undefined;
}

/**
 * Describes errors reported by observers. Includes call to trigger validation message on.
 */
export interface ObserverError {
    error: ValidationError;
    call: SdsCall;
}

export interface ProtocolObserver {
    /** Called on every successful ElementaryBlock match during protocol validation. */
    onElementaryMatch(info: MatchInfo): void;
    /** Called once after the full protocol is validated. Returns the found errors. */
    finalize(): ObserverError[];
}

type ObservedEntry = { callable: SdsCallable; call: SdsCall };

/**
 * Observes ElementaryBlock matches during protocol validation and checks three levels
 * of consistency for callables applied to different dataset partitions within the
 * tracked phases:
 *  1. Presence  — the same callables are applied the same number of times to all datasets (except 'fit' which must only be applied to the training set)
 *  2. Order     — the callables are applied in the same order on all datasets
 *  3. Dataflow  — each callable's output flows into the same successor callables on all datasets
 */
export class ConsistentTransformationObserver implements ProtocolObserver {
    // dataset -> (callable, call)[] for every observed call, in order of appearance (occurrences are not deduplicated)
    private readonly datasetCallableMap = new Map<DataSet, ObservedEntry[]>();
    // input placeholder -> the normalized callables that consume it (recorded for every call)
    private readonly consumers = new Map<SdsPlaceholder, SdsCallable[]>();

    constructor(
        private readonly services: SafeDsServices,
        // pipeline-level statements, used to discover which dataset partitions exist (see seedExistingPartitions)
        private readonly statements: SdsStatement[],
        private readonly trackedPhases: string[],
        private readonly excludedActivities: Activity[] = [],
    ) {}

    onElementaryMatch(info: MatchInfo): void {
        if (!info.phaseName || !info.callable || !info.detectedDataset) return;
        if (!this.trackedPhases.includes(info.phaseName)) return;
        if (this.excludedActivities.includes(info.activity)) return;
        if (info.detectedDataset === DataSet.Fallback) return;
        if (info.activity === DSPipelineActivity.Any) return;

        // normalize by eliminating 'fit' calls and mapping 'transform' and 'fitAndTransform' 
        // to their underlying class, so they are treated as the same callable across datasets.
        // also map 'transformTable' to the class used in its argument, to be able to 
        // differentiate different transform calls.
        const normalizedCallable = this.normalizeCallable(info.callable, info.call);
        if (!normalizedCallable) return; // it was a 'fit' call
        
        // record the callable for the detected dataset
        this.recordEntry(info.detectedDataset, normalizedCallable, info.call);
    }

    /**
     * Records an observed callable for a dataset. Every occurrence is appended in order, so the
     * per-dataset list reflects how many times (and in which order) each callable is applied — the
     * presence check compares occurrence counts and the order/dataflow checks align the lists
     * index-by-index (which is sound because count-aware presence guarantees equal lengths first).
     * Every data input of the call is additionally indexed in 'consumers' (used by the dataflow check).
     */
    private recordEntry(dataset: DataSet, callable: SdsCallable, call: SdsCall): void {
        // index this callable as a consumer of each of the call's data inputs, so the dataflow
        // check can later look up which callables a given placeholder flows into
        for (const inputVariable of this.inputVarsOf(call)) {
            let consumingCallables = this.consumers.get(inputVariable);
            if (!consumingCallables) { consumingCallables = []; this.consumers.set(inputVariable, consumingCallables); }
            if (!consumingCallables.includes(callable)) consumingCallables.push(callable);
        }

        let datasetOps = this.datasetCallableMap.get(dataset);
        if (!datasetOps) { datasetOps = []; this.datasetCallableMap.set(dataset, datasetOps); }
        datasetOps.push({ callable, call });
    }

    /**
     * Normalize callables by skipping 'fit' calls: they will only appear on the training set
     * (as validated in 'data-flow-analysis/datasetUsage.ts').
     * Also map calls to their underlying transformer class, so the same transformer is treated as
     * the same callable across datasets regardless of which API shape applied it:
     *  - 'transform'/'fitAndTransform' are methods on the transformer -> use its container class
     *  - 'table.transformTable(transformer)' is a method on the table -> use the transformer
     *    argument's class, so 'transformTable(imputer)' and 'transformTable(scaler)' stay distinct
     */
    private normalizeCallable(callable: SdsCallable, call: SdsCall): SdsCallable | null {
        // keep segments as they are
        if (!isSdsFunction(callable)) return callable;
        // ignore 'fit'
        if (callable.name === 'fit') return null;

        // if 'fitAndTransform' or 'transform', consider the underlying class as callable
        // this way these calls are treated the same for validation and test set
        if (callable.name === 'fitAndTransform' || callable.name === 'transform') {
            return AstUtils.getContainerOfType(callable, isSdsClass) ?? callable;
        }

        // 'transformTable' takes the transformer as an argument; key by the transformer's class
        // this way multiple calls with different transformers are treated differently
        if (callable.name === 'transformTable') {
            return this.transformerArgumentClass(call) ?? callable;
        }

        return callable;
    }

    /**
     * Resolves the class of the (first) transformer argument of a call via its type, so calls like
     * 'transformTable(imputer)' and 'transformTable(scaler)' are keyed by their distinct classes.
     */
    private transformerArgumentClass(call: SdsCall): SdsClass | undefined {
        for (const argument of call.argumentList.arguments) {
            const type = this.services.typing.TypeComputer.computeType(argument.value);
            // since 'transformTable' only receives one argument, this mapping is unambigous
            if (type instanceof ClassType) return type.declaration;
        }
        return undefined;
    }

    /**
     * Finalizes the observer by checking calling the checks for presence, order and dataflow 
     * consistency in this order and returning only the first error found.
     */
    finalize(): ObserverError[] {
        // make sure every existing dataset partition participates, even one that received no
        // tracked calls, so the presence check can flag partitions missing transformations entirely
        this.seedExistingPartitions();

        const presenceCheck = this.checkPresence();
        if (presenceCheck.length > 0) {
            // presence inconsistencies are a prerequisite for order and dataflow inconsistencies
            return presenceCheck;
        }
        const orderCheck = this.checkOrder();
        if (orderCheck.length > 0) {
            // order inconsistencies are a prerequisite for dataflow inconsistencies
            return orderCheck;
        }
        const dataflowCheck = this.checkDataflow();
        if (dataflowCheck.length > 0) {
            // most specific check, only returned if no presence or order inconsistencies were found
            return dataflowCheck;
        }
        return [];
    }

    /**
     * Ensures each dataset partition that exists in the pipeline (training/validation/test) appears
     * in 'datasetCallableMap', seeding an empty list for any partition that received no tracked calls.
     * Without this, a partition that is never transformed would be invisible to the presence check.
     */
    private seedExistingPartitions(): void {
        if (this.statements.length === 0) return; // empty pipeline, nothing to compare

        const identifier = this.services.flow.DatasetIdentifier;
        const partitionExists: [DataSet, boolean][] = [
            [DataSet.Training,   Boolean(identifier.getTrainingSetPlaceholder(this.statements))],
            [DataSet.Validation, Boolean(identifier.getValidationSetPlaceholder(this.statements))],
            [DataSet.Test,       Boolean(identifier.getTestSetPlaceholder(this.statements))],
        ];

        for (const [partition, exists] of partitionExists) {
            if (exists && !this.datasetCallableMap.has(partition)) {
                this.datasetCallableMap.set(partition, []);
            }
        }
    }


    /**
     * Checks for consistent presence of callables across datasets: each callable must be applied
     * the same number of times on every dataset. Comparing counts (not mere membership) means a
     * callable applied a different number of times is reported here, which also guarantees the
     * per-dataset lists are equal length for the order and dataflow checks that run afterwards.
     */
    private checkPresence(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.datasetCallableMap.keys()];
        if (usedDatasets.length < 2) return errors;

        // choose training as reference dataset for comparison if possible
        const referenceDataset = usedDatasets.includes(DataSet.Training)
            ? DataSet.Training : usedDatasets[0]!;

        // build the union of all callables observed across datasets
        const allCallables = new Set<SdsCallable>();
        for (const entries of this.datasetCallableMap.values()) {
            for (const { callable } of entries) allCallables.add(callable);
        }

        // for each other dataset, report every callable whose occurrence count differs from the reference
        for (const dataset of usedDatasets) {
            if (dataset === referenceDataset) continue;

            for (const callable of allCallables) {
                const referenceCount = this.countOf(referenceDataset, callable);
                const datasetCount = this.countOf(dataset, callable);
                if (referenceCount === datasetCount) continue;

                // report on a call from whichever dataset actually applies the callable
                const representativeCall =
                    this.datasetCallableMap.get(dataset)!.find(e => e.callable === callable)?.call
                    ?? this.datasetCallableMap.get(referenceDataset)!.find(e => e.callable === callable)!.call;
                errors.push({
                    error: new InconsistentTransformationPresenceError(
                        this.callableName(callable), referenceDataset, referenceCount, dataset, datasetCount,
                    ),
                    call: representativeCall,
                });
            }
        }
        return errors;
    }

    /**
     * Counts how many times a callable is applied on a dataset.
     */
    private countOf(dataset: DataSet, callable: SdsCallable): number {
        return this.datasetCallableMap.get(dataset)?.filter(e => e.callable === callable).length ?? 0;
    }

    /**
     * Checks for consistent order of callables across datasets, assuming they are all present.
     * Since this check only happens after presence inconsistencies have been ruled out, it can be 
     * assumed that the same callables appear on all datasets.
     */
    private checkOrder(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.datasetCallableMap.keys()];
        if (usedDatasets.length < 2) return errors;

        // choose training as reference dataset for order comparison if possible
        const referenceDataset = usedDatasets.includes(DataSet.Training)
            ? DataSet.Training : usedDatasets[0]!;
        const referenceEntries = this.datasetCallableMap.get(referenceDataset)!;

        for (const dataset of usedDatasets) {
            if (dataset === referenceDataset) continue;
            const datasetEntries = this.datasetCallableMap.get(dataset)!;
            
            // find the first deviating callable to report the error on
            const firstDiff = datasetEntries.find((e, i) => e.callable !== referenceEntries[i]?.callable)!;
            
            // at least one difference in callable order was found, report error
            if (firstDiff) {
                // build readable callable names for error message
                const refNames = referenceEntries.map(e => this.callableName(e.callable));
                const devNames = datasetEntries.map(e => this.callableName(e.callable));
                
                errors.push({
                    error: new InconsistentTransformationOrderError(referenceDataset, refNames, dataset, devNames),
                    call: firstDiff.call,
                });
            }            
        }
        return errors;
    }

    /**
     * Checks for consistent dataflow: a callable's output must flow into the same successor
     * callables on every dataset. Since this check only happens after presence and order
     * inconsistencies have been ruled out, the same callables appear in the same order on all
     * datasets, so the per-dataset entry lists line up index-by-index.
     */
    private checkDataflow(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.datasetCallableMap.keys()];
        if (usedDatasets.length < 2) return errors;

        // choose training as reference dataset for comparison if possible (mirrors checkOrder)
        const referenceDataset = usedDatasets.includes(DataSet.Training)
            ? DataSet.Training : usedDatasets[0]!;
        const referenceEntries = this.datasetCallableMap.get(referenceDataset)!;

        for (const dataset of usedDatasets) {
            if (dataset === referenceDataset) continue;
            const datasetEntries = this.datasetCallableMap.get(dataset)!;

            // presence and order are already guaranteed, so entries line up index-by-index
            for (let i = 0; i < referenceEntries.length; i++) {
                // entries at index i correspond to the same callable on both datasets
                const referenceEntry = referenceEntries[i]!;
                const datasetEntry = datasetEntries[i]!;

                // the callables that consume each entry's output (its successors in the data flow)
                const referenceSuccessors = this.successorsOf(referenceEntry);
                const datasetSuccessors = this.successorsOf(datasetEntry);

                // the same callable's output must flow into the same successors on every dataset
                if (!this.sameCallables(referenceSuccessors, datasetSuccessors)) {
                    errors.push({
                        error: new InconsistentTransformationDataflowError(
                            this.callableName(datasetEntry.callable),
                            referenceDataset,
                            dataset,
                            referenceSuccessors.map(callable => this.callableName(callable)),
                            datasetSuccessors.map(callable => this.callableName(callable)),
                        ),
                        call: datasetEntry.call,
                    });
                    // report only the first deviation per dataset
                    break;
                }
            }
        }
        return errors;
    }

    /**
     * Returns the callables that consume the output of an entry (its successors in the data flow),
     * or an empty list if the output flows into nothing tracked (e.g. it is a final result).
     */
    private successorsOf(entry: ObservedEntry): SdsCallable[] {
        const outputVariable = this.outputVarOf(entry.call);
        if (!outputVariable) return [];
        return this.consumers.get(outputVariable) ?? [];
    }

    /**
     * Determines the data placeholder that 'call' produces: the placeholder assignee of the
     * enclosing assignment, but only when 'call' is the outermost call of its right-hand side.
     * This way nested calls (e.g. the inner 'f' in 'g(f(train))') do not claim the assignee.
     */
    private outputVarOf(call: SdsCall): SdsPlaceholder | undefined {
        const assignment = AstUtils.getContainerOfType(call, isSdsAssignment);
        if (!assignment || !assignment.expression) return undefined;

        // only the outermost call of the right-hand side produces the assigned variable
        const outermostCall = AstUtils.streamAst(assignment.expression as AstNode).filter(isSdsCall).head();
        if (outermostCall !== call) return undefined;

        return getAssignees(assignment).find(isSdsPlaceholder);
    }

    /**
     * Returns true if both lists contain the same callables, ignoring order, 
     * since order is checked separately in checkOrder().
     */
    private sameCallables(a: SdsCallable[], b: SdsCallable[]): boolean {
        return a.length === b.length && a.every(callable => b.includes(callable));
    }

    /**
     * Determines the data placeholders that 'call' receives as input: the member-access receiver
     * base ('train.transformTable(...)') and every data-typed reference argument
     * ('table.appendRows(other)', 'transformer.transform(train, ...)').
     */
    private inputVarsOf(call: SdsCall): SdsPlaceholder[] {
        const inputs: SdsPlaceholder[] = [];

        // member-access receiver base, e.g. 'train.transformTable(...)'
        if (isSdsMemberAccess(call.receiver)) {
            const base = call.receiver.receiver;
            if (isSdsReference(base) && isSdsPlaceholder(base.target.ref) && this.isData(base.target.ref)) {
                inputs.push(base.target.ref);
            }
        }

        // every data-typed reference argument, e.g. 'table.appendRows(other)'
        for (const argument of call.argumentList.arguments) {
            if (!isSdsReference(argument.value)) continue;
            const reference = argument.value.target.ref;
            if (isSdsPlaceholder(reference) && this.isData(reference)) inputs.push(reference);
        }

        return inputs;
    }

    /**
     * Helper to check whether a placeholder is data-typed, by delegating to the DataFlowAnalyzer.
     */
    private isData(placeholder: SdsPlaceholder): boolean {
        return this.services.flow.DataFlowAnalyzer.isData(placeholder);
    }

    /**
     * Helper to get the callable name.
     */
    private callableName(callable: SdsCallable): string {
        return isSdsFunction(callable) || isSdsClass(callable) ? callable.name : callable.$type;
    }

}
