import { AstNode, AstUtils } from 'langium';
import {
    isSdsAssignment, isSdsCall, isSdsClass, isSdsFunction, isSdsMemberAccess, isSdsPlaceholder, isSdsReference,
    isSdsStatement, SdsCall, SdsCallable, SdsClass, SdsPlaceholder, SdsStatement,
} from '../../../generated/ast.js';
import { ClassType } from '../../../typing/model.js';
import { DataSet } from '../../../flow/safe-ds-dataset-identifier.js';
import { SafeDsServices } from '../../../safe-ds-module.js';
import { getAssignees, getParameters } from '../../../helpers/nodeProperties.js';
import { Activity } from './model.js';
import { DSPipelineActivity } from './dsPipelineActivity.js';
import { DSPipelinePhase } from './dsPipelinePhase.js';
import {
    InconsistentTransformationPresenceError,
    InconsistentTransformationOrderError,
    InconsistentTransformationDataflowError,
    InconsistentTransformationArgumentsError,
    SingleTestingAdvice,
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

// 'callable' is the normalized identity used for matching (see normalizeCallable); 'displayName'
// is the explicit, human-readable name used only in messages (see displayNameOf), combining the
// class (if any) with the actual call name so diagnostics name the concrete operation.
type ObservedEntry = { callable: SdsCallable; call: SdsCall; displayName: string };

/**
 * Observes ElementaryBlock matches during protocol validation and checks three levels
 * of consistency for callables applied to different dataset partitions within the
 * tracked phases:
 *  1. Presence  — the same callables are applied the same number of times to all datasets (except 'fit' which must only be applied to the training set)
 *  2. Order     — the callables are applied in the same order on all datasets
 *  3. Dataflow  — each callable's output flows into the same successor callables on all datasets
 *  4. Arguments — each callable is passed the same argument values on all datasets
 */
export class ConsistentTransformationObserver implements ProtocolObserver {
    // dataset -> (callable, call)[] for every observed call, in order of appearance (occurrences are not deduplicated)
    private readonly datasetCallableMap = new Map<DataSet, ObservedEntry[]>();
    // input placeholder -> the normalized callables that consume it (recorded for every call)
    private readonly consumers = new Map<SdsPlaceholder, SdsCallable[]>();
    // normalized callable -> a representative explicit display name (used to name dataflow successors,
    // which are only known as normalized callables via 'consumers')
    private readonly callableDisplayNames = new Map<SdsCallable, string>();
    // lazily-computed pipeline statements that feed a model (backward slice of every 'toTabularDataset')
    private modelFeedingStatements: Set<SdsStatement> | undefined;
    // lazily-computed map from every expanded call to the pipeline-level statement containing it
    // (for a call inlined from a segment, this is the segment call site statement)
    private callToPipelineStatement: Map<SdsCall, SdsStatement> | undefined;

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

        // Plot-only escape (training set only): a tracked TRAINING call whose output never reaches the
        // model (no dataflow path into a 'toTabularDataset') is exploratory shaping, not part of the
        // model pipeline, so it must not be held to cross-partition consistency. Held-out partitions are
        // never escaped — shaping/inspecting validation or test data off the model-feeding path stays
        // tracked and is reported.
        if (info.detectedDataset === DataSet.Training && !this.reachesModel(info.call)) return;

        // normalize by eliminating 'fit' calls and mapping 'transform' and 'fitAndTransform'
        // to their underlying class, so they are treated as the same callable across datasets.
        // also map 'transformTable' to the class used in its argument, to be able to 
        // differentiate different transform calls.
        const normalizedCallable = this.normalizeCallable(info.callable, info.call);
        if (!normalizedCallable) return; // it was a 'fit' call

        // build the explicit display name from the original call name and the normalized class (if any),
        // so messages name the concrete operation while matching still uses the normalized identity
        const displayName = this.displayNameOf(info.callable, normalizedCallable);

        // record the callable for the detected dataset
        this.recordEntry(info.detectedDataset, normalizedCallable, info.call, displayName);
    }

    /**
     * Records an observed callable for a dataset. Every occurrence is appended in order, so the
     * per-dataset list reflects how many times (and in which order) each callable is applied — the
     * presence check compares occurrence counts and the order/dataflow checks align the lists
     * index-by-index (which is sound because count-aware presence guarantees equal lengths first).
     * Every data input of the call is additionally indexed in 'consumers' (used by the dataflow check).
     */
    private recordEntry(dataset: DataSet, callable: SdsCallable, call: SdsCall, displayName: string): void {
        // index this callable as a consumer of each of the call's data inputs, so the dataflow
        // check can later look up which callables a given placeholder flows into
        for (const inputVariable of this.inputVarsOf(call)) {
            let consumingCallables = this.consumers.get(inputVariable);
            if (!consumingCallables) { consumingCallables = []; this.consumers.set(inputVariable, consumingCallables); }
            if (!consumingCallables.includes(callable)) consumingCallables.push(callable);
        }

        // remember a representative display name for this normalized callable, so the dataflow check
        // (which only has normalized callables for successors) can name them explicitly too
        this.callableDisplayNames.set(callable, displayName);

        let datasetOps = this.datasetCallableMap.get(dataset);
        if (!datasetOps) { datasetOps = []; this.datasetCallableMap.set(dataset, datasetOps); }
        datasetOps.push({ callable, call, displayName });
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
     * Finalizes the observer by checking calling the checks for presence, order, dataflow and
     * argument consistency in this order and returning only the first error found.
     */
    finalize(): ObserverError[] {
        // make sure every existing dataset partition participates, even one that received no
        // tracked calls, so the presence check can flag partitions missing transformations entirely
        this.seedExistingPartitions();

        const presenceCheck = this.checkPresence();
        if (presenceCheck.length > 0) {
            // presence inconsistencies are a prerequisite for order, dataflow and argument inconsistencies
            return presenceCheck;
        }
        const orderCheck = this.checkOrder();
        if (orderCheck.length > 0) {
            // order inconsistencies are a prerequisite for dataflow and argument inconsistencies
            return orderCheck;
        }
        const dataflowCheck = this.checkDataflow();
        if (dataflowCheck.length > 0) {
            // returned before the argument check if any dataflow inconsistency was found
            return dataflowCheck;
        }
        const argumentCheck = this.checkArguments();
        if (argumentCheck.length > 0) {
            // most specific check, only returned if no presence, order or dataflow inconsistencies were found
            return argumentCheck;
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

                // report on an entry from whichever dataset actually applies the callable
                const representativeEntry =
                    this.datasetCallableMap.get(dataset)!.find(e => e.callable === callable)
                    ?? this.datasetCallableMap.get(referenceDataset)!.find(e => e.callable === callable)!;
                errors.push({
                    error: new InconsistentTransformationPresenceError(
                        representativeEntry.displayName, referenceDataset, referenceCount, dataset, datasetCount,
                    ),
                    call: representativeEntry.call,
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
                const refNames = referenceEntries.map(e => e.displayName);
                const devNames = datasetEntries.map(e => e.displayName);
                
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
                            datasetEntry.displayName,
                            referenceDataset,
                            dataset,
                            referenceSuccessors.map(callable => this.successorDisplayName(callable)),
                            datasetSuccessors.map(callable => this.successorDisplayName(callable)),
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
     * Checks for consistent arguments: a callable applied on several partitions must be passed the
     * same argument values on every one of them. Since this check only happens after presence, order
     * and dataflow inconsistencies have been ruled out, the same callables appear in the same order on
     * all datasets, so the per-dataset entry lists line up index-by-index and each aligned pair is the
     * same callable applied at the same position — only its arguments can still differ.
     *
     * Only the argument values literally present on each aligned call are compared. Values are resolved
     * with the partial evaluator (so named/positional forms compare equal); data inputs — the partition
     * table, transformer placeholders — do not resolve to a constant and are therefore skipped, leaving
     * only genuine configuration arguments. Aligned calls may use differing API shapes (e.g. training
     * 'fitAndTransform' vs held-out 'transform'), so only parameters shared by both signatures are compared.
     */
    private checkArguments(): ObserverError[] {
        const errors: ObserverError[] = [];
        const usedDatasets = [...this.datasetCallableMap.keys()];
        if (usedDatasets.length < 2) return errors;

        // choose training as reference dataset for comparison if possible (mirrors checkOrder/checkDataflow)
        const referenceDataset = usedDatasets.includes(DataSet.Training)
            ? DataSet.Training : usedDatasets[0]!;
        const referenceEntries = this.datasetCallableMap.get(referenceDataset)!;

        for (const dataset of usedDatasets) {
            if (dataset === referenceDataset) continue;
            const datasetEntries = this.datasetCallableMap.get(dataset)!;

            // presence and order are already guaranteed, so entries line up index-by-index
            for (let i = 0; i < referenceEntries.length; i++) {
                const referenceEntry = referenceEntries[i]!;
                const datasetEntry = datasetEntries[i]!;

                const referenceArgs = this.argValuesOf(referenceEntry.call);
                const datasetArgs = this.argValuesOf(datasetEntry.call);

                // compare only parameters resolved on both sides; report the first that disagrees
                let deviation: { parameter: string; referenceValue: string; deviatingValue: string } | undefined;
                for (const [parameter, deviatingValue] of datasetArgs) {
                    const referenceValue = referenceArgs.get(parameter);
                    if (referenceValue !== undefined && referenceValue !== deviatingValue) {
                        deviation = { parameter, referenceValue, deviatingValue };
                        break;
                    }
                }
                if (!deviation) continue;

                errors.push({
                    error: new InconsistentTransformationArgumentsError(
                        datasetEntry.displayName,
                        referenceDataset,
                        dataset,
                        deviation.parameter,
                        deviation.referenceValue,
                        deviation.deviatingValue,
                    ),
                    call: datasetEntry.call,
                });
                // report only the first deviation per dataset
                break;
            }
        }
        return errors;
    }

    /**
     * Resolves the argument values of a call to canonical strings, keyed by parameter name. Uses the
     * partial evaluator so named/positional forms and defaults compare equal. Parameters that do not
     * resolve to a constant (e.g. the partition table or a transformer placeholder — data inputs) are
     * omitted, leaving only configuration arguments comparable across partitions.
     */
    private argValuesOf(call: SdsCall): Map<string, string> {
        const substitutions = this.services.evaluation.PartialEvaluator.computeParameterSubstitutionsForCall(call);
        const parameters = getParameters(this.services.helpers.NodeMapper.callToCallable(call));

        const values = new Map<string, string>();
        for (const parameter of parameters) {
            const value = substitutions.get(parameter)?.toString();
            if (value !== undefined) values.set(parameter.name, value);
        }
        return values;
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

    /**
     * Returns the explicit display name recorded for a normalized callable (used to name dataflow
     * successors, which are only known as normalized callables), falling back to the plain callable
     * name if none was recorded.
     */
    private successorDisplayName(callable: SdsCallable): string {
        return this.callableDisplayNames.get(callable) ?? this.callableName(callable);
    }

    /**
     * Builds the explicit display name used in messages. Combines the actual call name (the invoked
     * function, e.g. 'transformTable', 'fitAndTransform', or a plain function like 'addIndexColumn')
     * with the class the call was normalized to, when one exists (the container class for
     * 'transform'/'fitAndTransform', or the transformer-argument class for 'transformTable'). Formatted
     * as 'callName (ClassName)' so both are visible, or just 'callName' when there is no associated class.
     */
    private displayNameOf(originalCallable: SdsCallable, normalizedCallable: SdsCallable): string {
        const callName = this.callableName(originalCallable);
        // the normalized callable is a class only for transformer calls; plain functions and segments
        // normalize to themselves, in which case there is no separate class to show
        if (isSdsClass(normalizedCallable) && normalizedCallable !== originalCallable) {
            return `${callName} (${normalizedCallable.name})`;
        }
        return callName;
    }

    /**
     * Returns true if 'call' lies on a dataflow path into the model, i.e. its enclosing pipeline
     * statement is in the backward slice of some 'toTabularDataset' call. Lets purely exploratory
     * training-set shaping (e.g. 'train.selectColumns(...).plot...') skip consistency tracking without
     * masking anything that actually feeds the model.
     */
    private reachesModel(call: SdsCall): boolean {
        const modelFeeding = this.getModelFeedingStatements();
        // No 'toTabularDataset' anywhere: the model boundary is undefined, so "off the model path" is
        // vacuous. Stay conservative and escape nothing, leaving plain consistency tracking in place.
        if (modelFeeding.size === 0) return true;

        const statement = this.callToPipelineStatementMap().get(call);
        if (!statement) return false;
        return modelFeeding.has(statement);
    }

    /**
     * Builds (once) a map from every expanded call to the pipeline-level statement containing it.
     * A call inlined from a segment maps to its segment call site statement, so membership tests
     * against the pipeline-level slice stay meaningful. Keyed by the same call nodes the protocol
     * matches on (both come from 'expandCallsInStatement').
     */
    private callToPipelineStatementMap(): Map<SdsCall, SdsStatement> {
        if (this.callToPipelineStatement) return this.callToPipelineStatement;
        const map = new Map<SdsCall, SdsStatement>();
        const analyzer = this.services.flow.DataFlowAnalyzer;
        for (const statement of this.statements) {
            for (const { call } of analyzer.expandCallsInStatement(statement)) {
                if (!map.has(call)) map.set(call, statement);
            }
        }
        this.callToPipelineStatement = map;
        return map;
    }

    /**
     * Computes (once) the set of pipeline statements that contribute to producing the input of any
     * 'toTabularDataset' call — the backward slice to every such call. Statements outside this set do
     * not feed the model. Pure slicing is used (shaping ops are pure; only data dependencies matter).
     */
    private getModelFeedingStatements(): Set<SdsStatement> {
        if (this.modelFeedingStatements) return this.modelFeedingStatements;
        const nodeMapper = this.services.helpers.NodeMapper;

        // every pipeline statement that (directly, inline, or via a segment) contains a 'toTabularDataset' call
        const targets = new Set<SdsStatement>();
        for (const [call, statement] of this.callToPipelineStatementMap()) {
            const callable = nodeMapper.callToCallable(call);
            if (isSdsFunction(callable) && callable.name === 'toTabularDataset') targets.add(statement);
        }

        // copy the statements: computeBackwardSliceToTargetsWithoutPurity reverses its input in place
        const slice = this.services.flow.Slicer.computeBackwardSliceToTargetsWithoutPurity(
            [...this.statements], [...targets],
        );
        this.modelFeedingStatements = new Set(slice);
        return this.modelFeedingStatements;
    }

}

/**
 * Observes ElementaryBlock matches during protocol validation and reports an informational advice on
 * every statement of the testing phase: the test set should be used only once, for a single final
 * estimate of the model's performance on unseen data. Hyperparameter optimization belongs on the
 * validation set. The advice is emitted once per statement, even when a statement contains several
 * matched calls.
 */
export class SingleTestingObserver implements ProtocolObserver {
    // one representative call per testing-phase statement, so each statement is reported exactly once
    private readonly testingStatements = new Map<SdsStatement, SdsCall>();

    onElementaryMatch(info: MatchInfo): void {
        // only statements the protocol attributed to the testing phase are of interest
        if (info.phaseName !== DSPipelinePhase.Testing) return;

        const statement = AstUtils.getContainerOfType(info.call, isSdsStatement);
        if (!statement) return;
        // keep the first matched call of the statement as the anchor for the diagnostic
        if (!this.testingStatements.has(statement)) this.testingStatements.set(statement, info.call);
    }

    finalize(): ObserverError[] {
        return [...this.testingStatements.values()].map(call => ({
            error: new SingleTestingAdvice(),
            call,
        }));
    }
}
