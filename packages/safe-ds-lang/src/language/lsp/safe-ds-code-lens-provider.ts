import { CodeLensProvider } from 'langium/lsp';
import { CancellationToken, CodeLens, type CodeLensParams, Range } from 'vscode-languageserver';
import { SafeDsServices } from '../safe-ds-module.js';
import { SafeDsTypeComputer } from '../typing/safe-ds-type-computer.js';
import { AstNode, AstNodeLocator, AstUtils, interruptAndCheck, LangiumDocument } from 'langium';
import {
    isSdsAssignment,
    isSdsClass,
    isSdsFunction,
    isSdsModule,
    isSdsOutputStatement,
    isSdsPipeline,
    isSdsPlaceholder,
    isSdsReference,
    SdsAssignment,
    SdsLocalVariable,
    SdsModuleMember,
    SdsOutputStatement,
    SdsPipeline,
    SdsPlaceholder,
} from '../generated/ast.js';
import { SafeDsRunner } from '../runtime/safe-ds-runner.js';
import { getAssignees, getModuleMembers, getStatements } from '../helpers/nodeProperties.js';
import { SafeDsTypeChecker } from '../typing/safe-ds-type-checker.js';

import { SafeDsDatasetIdentifier } from '../flow/safe-ds-dataset-identifier.js';
import { SafeDsDataFlowAnalyzer } from '../flow/safe-ds-data-flow-analyzer.js';
import { SafeDsAnnotations } from '../builtins/safe-ds-annotations.js';
import { SafeDsNodeMapper } from '../helpers/safe-ds-node-mapper.js';
import { DSPipelineActivity, phaseOf } from '../validation/pipeline/protocol/dsPipelineActivity.js';
import { DSPipelinePhase } from '../validation/pipeline/protocol/dsPipelinePhase.js';

/** Phases in which holdout data may be inspected: the outputs of evaluation and testing operations. */
const UNLOCK_PHASES: ReadonlySet<string> = new Set([DSPipelinePhase.Evaluation, DSPipelinePhase.Testing]);

import {
    COMMAND_EXPLORE_TABLE,
    COMMAND_PRINT_VALUE,
    COMMAND_RUN_PIPELINE,
    COMMAND_SHOW_IMAGE,
} from '../communication/commands.js';
import { NamedTupleType, Type } from '../typing/model.js';
import { SafeDsSyntheticProperties } from '../helpers/safe-ds-synthetic-properties.js';

export class SafeDsCodeLensProvider implements CodeLensProvider {
    private readonly annotations: SafeDsAnnotations;
    private readonly astNodeLocator: AstNodeLocator;
    private readonly dataFlowAnalyzer: SafeDsDataFlowAnalyzer;
    private readonly datasetIdentifier: SafeDsDatasetIdentifier;
    private readonly nodeMapper: SafeDsNodeMapper;
    private readonly runner: SafeDsRunner;
    private readonly syntheticProperties: SafeDsSyntheticProperties;
    private readonly typeChecker: SafeDsTypeChecker;
    private readonly typeComputer: SafeDsTypeComputer;

    constructor(services: SafeDsServices) {
        this.annotations = services.builtins.Annotations;
        this.astNodeLocator = services.workspace.AstNodeLocator;
        this.dataFlowAnalyzer = services.flow.DataFlowAnalyzer;
        this.datasetIdentifier = services.flow.DatasetIdentifier;
        this.nodeMapper = services.helpers.NodeMapper;
        this.runner = services.runtime.Runner;
        this.syntheticProperties = services.helpers.SyntheticProperties;
        this.typeChecker = services.typing.TypeChecker;
        this.typeComputer = services.typing.TypeComputer;
    }

    async provideCodeLens(
        document: LangiumDocument,
        _params: CodeLensParams,
        cancelToken: CancellationToken = CancellationToken.None,
    ): Promise<CodeLens[] | undefined> {
        if (!this.runner.isReady()) {
            return;
        }

        const root = document.parseResult.value;
        if (!isSdsModule(root)) {
            /* c8 ignore next 2 */
            return;
        }

        const result: CodeLens[] = [];
        const acceptor: CodeLensAcceptor = (codeLens) => result.push(codeLens);

        for (const node of getModuleMembers(root)) {
            await interruptAndCheck(cancelToken);
            await this.computeCodeLensForModuleMember(node, acceptor);
        }

        return result;
    }

    private async computeCodeLensForModuleMember(
        node: SdsModuleMember,
        accept: CodeLensAcceptor,
        cancelToken: CancellationToken = CancellationToken.None,
    ): Promise<void> {
        if (isSdsPipeline(node)) {
            await this.computeCodeLensForPipeline(node, accept);

            const statements = getStatements(node.body);
            const holdoutVariables = this.datasetIdentifier.getHoldoutVariables(statements);

            for (const statement of statements) {
                await interruptAndCheck(cancelToken);
                if (isSdsAssignment(statement)) {
                    await this.computeCodeLensForAssignment(statement, accept, holdoutVariables);
                } else if (isSdsOutputStatement(statement)) {
                    await this.computeCodeLensForOutputStatement(statement, accept, holdoutVariables);
                }
            }
        }
    }

    private async computeCodeLensForPipeline(node: SdsPipeline, accept: CodeLensAcceptor): Promise<void> {
        const cstNode = node.$cstNode;
        if (!cstNode) {
            /* c8 ignore next 2 */
            return;
        }

        accept({
            range: cstNode.range,
            command: {
                title: `Run ${node.name}`,
                command: COMMAND_RUN_PIPELINE,
                arguments: this.computeNodeId(node),
            },
        });
    }

    private async computeCodeLensForAssignment(
        node: SdsAssignment,
        accept: CodeLensAcceptor,
        holdoutVariables: HoldoutVariables,
        cancelToken: CancellationToken = CancellationToken.None,
    ): Promise<void> {
        for (const assignee of getAssignees(node)) {
            await interruptAndCheck(cancelToken);
            if (isSdsPlaceholder(assignee)) {
                await this.computeCodeLensForPlaceholder(node, assignee, accept, holdoutVariables);
            }
        }
    }

    private async computeCodeLensForPlaceholder(
        assignment: SdsAssignment,
        placeholder: SdsPlaceholder,
        accept: CodeLensAcceptor,
        holdoutVariables: HoldoutVariables,
    ): Promise<void> {
        // Suppress lenses for holdout placeholders, unless unlocked by their phase.
        if (this.isHoldoutSuppressed(placeholder, holdoutVariables)) {
            return;
        }

        const cstNode = placeholder.$cstNode;
        if (!cstNode) {
            /* c8 ignore next 2 */
            return;
        }

        const type = this.typeComputer.computeType(placeholder);
        await this.computeCodeLensForValue(
            type,
            placeholder.name,
            this.computeNodeId(assignment),
            cstNode.range,
            accept,
        );
    }

    private async computeCodeLensForOutputStatement(
        node: SdsOutputStatement,
        accept: CodeLensAcceptor,
        holdoutVariables: HoldoutVariables,
        cancelToken: CancellationToken = CancellationToken.None,
    ): Promise<void> {
        // `out <holdout reference>` follows the same rule as the placeholder it points to.
        const reference = node.expression;
        if (isSdsReference(reference) && reference.target.ref &&
            this.isHoldoutSuppressed(reference.target.ref as SdsLocalVariable, holdoutVariables)) {
            return;
        }

        const cstNode = node.$cstNode;
        if (!cstNode) {
            /* c8 ignore next 2 */
            return;
        }

        // Compute type of expression and unpack if it is a named tuple
        const expressionType = this.typeComputer.computeType(node.expression);
        let unpackedTypes: Type[] = [expressionType];
        if (expressionType instanceof NamedTupleType) {
            unpackedTypes = expressionType.entries.map((it) => it.type);
        }

        // Get names of values
        const valueNames = this.syntheticProperties.getValueNamesForExpression(node.expression);

        // Create code lenses for each value
        for (let i = 0; i < unpackedTypes.length; i++) {
            await interruptAndCheck(cancelToken);

            await this.computeCodeLensForValue(
                unpackedTypes[i]!,
                valueNames[i] ?? 'expression',
                this.computeNodeId(node),
                cstNode.range,
                accept,
                { fallbackToPrint: true },
            );
        }
    }

    private async computeCodeLensForValue(
        type: Type,
        name: string,
        id: NodeId,
        range: Range,
        accept: CodeLensAcceptor,
        options: CodeLensForValueOptions = {},
    ): Promise<void> {
        if (this.typeChecker.isImage(type)) {
            accept({
                range,
                command: {
                    title: `Show ${name}`,
                    command: COMMAND_SHOW_IMAGE,
                    arguments: [name, id],
                },
            });
        } else if (this.typeChecker.isTable(type)) {
            accept({
                range,
                command: {
                    title: `Explore ${name}`,
                    command: COMMAND_EXPLORE_TABLE,
                    arguments: [name, id],
                },
            });
        } else if (options.fallbackToPrint || this.typeChecker.canBePrinted(type)) {
            accept({
                range,
                command: {
                    title: `Print ${name}`,
                    command: COMMAND_PRINT_VALUE,
                    arguments: [name, id],
                },
            });
        }
    }

    /**
     * Holdout data (rest/validation/test set and everything derived from it) has its lenses hidden,
     * except when the variable is produced by an evaluation or testing call, the phases where 
     * inspecting that data is the intended workflow and needs to be allowed.
     */
    private isHoldoutSuppressed(variable: SdsLocalVariable, holdoutVariables: HoldoutVariables): boolean {
        if (!holdoutVariables.has(variable)) return false;

        // Allow if the call that produced the variable is an evaluation/testing operation.
        const definition = AstUtils.getContainerOfType(variable, isSdsAssignment);
        if (!definition) return true;

        for (const { call } of this.dataFlowAnalyzer.expandCallsInStatement(definition)) {
            const callable = this.nodeMapper.callToCallable(call);
            if (!isSdsFunction(callable) && !isSdsClass(callable)) continue;

            const isEvaluationOrTesting = this.annotations
                .streamDSPipelineActivities(callable)
                .some((variant) => UNLOCK_PHASES.has(phaseOf(variant.name as DSPipelineActivity)));
            if (isEvaluationOrTesting) return false;
        }
        return true;
    }

    private computeNodeId(node: AstNode): NodeId {
        const documentUri = AstUtils.getDocument(node).uri;
        const nodePath = this.astNodeLocator.getAstNodePath(node);
        return [documentUri.toString(), nodePath];
    }
}

type CodeLensAcceptor = (codeLens: CodeLens) => void;
type NodeId = [string, string];

/** The set of holdout data variables (validation, test, and the rest pool). */
type HoldoutVariables = Set<SdsLocalVariable>;

/**
 * Options for the `computeCodeLensForValue` method.
 */
interface CodeLensForValueOptions {
    /**
     * If `true`, a print code lens is created, if no other code lens is applicable.
     */
    fallbackToPrint?: boolean;
}
