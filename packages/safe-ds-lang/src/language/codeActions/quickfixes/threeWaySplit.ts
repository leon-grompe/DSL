import { Diagnostic, TextEdit } from 'vscode-languageserver';
import { AstUtils, LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsAssignment, isSdsCall, isSdsFunction, isSdsMemberAccess, isSdsPlaceholder, isSdsReference, SdsCall, SdsExpression } from '../../generated/ast.js';
import { getAssignees } from '../../helpers/nodeProperties.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';
import { createQuickfixFromTextEditsToSingleDocument } from '../factories.js';

/**
 * When only one split, or multiple non-chained splits are detected within the pipline,
 * suggest a second split to split the data into 'training', 'validation' and 'test'.
 */
export const addThreeWaySplit = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const analyzer = services.flow.DataFlowAnalyzer;

    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        // recover the original split assignment from the diagnostic path.
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data?.path);
        if (!isSdsAssignment(node) || !node.$cstNode) return;

        // the rest set (second assignee) is split a second time.
        const restSet = getAssignees(node)[1];
        if (!isSdsPlaceholder(restSet)) return;

        // reuse the same splitting function as the original split ('splitRows' or 'split').
        let funcName: string | undefined;
        for (const { call } of analyzer.expandCallsInStatement(node)) {
            if (!isSdsCall(call)) continue;
            const callable = nodeMapper.callToCallable(call);
            if (isSdsFunction(callable) && (callable.name === 'splitRows' || callable.name === 'split')) {
                funcName = callable.name;
                break;
            }
        }
        if (!funcName) {
            return;
        }

        // insert the new split directly after the existing one, matching its indentation.
        const indent = ' '.repeat(node.$cstNode.range.start.character);
        const edit: TextEdit = {
            range: { start: node.$cstNode.range.end, end: node.$cstNode.range.end },
            newText: `\n${indent}val rawValidation, val rawTest = ${restSet.name}.${funcName}(0.5);`,
        };

        acceptor(
            createQuickfixFromTextEditsToSingleDocument(
                'Add a second split to partition the data into train, validation, and test sets.',
                diagnostic,
                document,
                [edit],
                true,
            ),
        );
    };
};

/**
 * When an illegal split (splitting the training set a second time) is detected within the pipeline,
 * correct this split by replacing the training set with the 'rest set' (other assignee)
 */
export const correctThreeWaySplit = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const analyzer = services.flow.DataFlowAnalyzer;

    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        // recover the illegal split assignment from the diagnostic path.
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data?.path);
        if (!isSdsAssignment(node)) return;

        // find every reference in this split that points to a placeholder produced by another split,
        // and redirect it to that split's rest set (its second assignee).
        const edits: TextEdit[] = [];
        AstUtils.streamAllContents(node).forEach((astNode) => {
            if (!isSdsReference(astNode) || !astNode.$cstNode) return;

            const target = astNode.target.ref;
            if (!isSdsPlaceholder(target)) return;

            // the split assignment that declared the referenced placeholder.
            const source = AstUtils.getContainerOfType(target, isSdsAssignment);
            if (!source || !analyzer.isSpecificCall(source, 'split')) return;

            const restSet = getAssignees(source)[1];
            // already referencing the rest set, or no usable rest set -> nothing to correct.
            if (!isSdsPlaceholder(restSet) || restSet === target) return;

            edits.push({ range: astNode.$cstNode.range, newText: restSet.name });
        });

        if (edits.length === 0) return;

        acceptor(
            createQuickfixFromTextEditsToSingleDocument(
                'Split the rest set instead, so the training set stays intact.',
                diagnostic,
                document,
                edits,
                true,
            ),
        );
    };
}