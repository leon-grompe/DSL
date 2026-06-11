import { Diagnostic, TextEdit } from 'vscode-languageserver';
import { AstUtils, LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsAssignment, isSdsCall, isSdsFunction, isSdsMemberAccess, isSdsPlaceholder, isSdsReference, SdsExpression } from '../../generated/ast.js';
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
        // recover the original split assignment from the diagnostic path
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data?.path);
        if (!isSdsAssignment(node) || !node.$cstNode) return;

        // the rest set (second assignee) is split a second time
        const restSet = getAssignees(node)[1];
        if (!isSdsPlaceholder(restSet)) return;

        // the inserted split introduces 'rawValidation' and 'rawTest'. if the rest set already uses
        // one of those names, rename its declaration to 'rawRest' to avoid a redeclaration clash.
        // (any existing usages of the old name are expected to be broken by design — the rest set
        // should not be consumed directly, it should be split first.)
        const edits: TextEdit[] = [];
        let restName = restSet.name;
        if ((restName === 'rawValidation' || restName === 'rawTest') && restSet.$cstNode) {
            restName = 'rawRest';
            edits.push({ range: restSet.$cstNode.range, newText: `val ${restName}` });
        }

        // reuse the same splitting function as the original split ('splitRows' or 'split')
        if (!analyzer.isSpecificCall(node, 'split') || !isSdsCall(node.expression)) return;
        const callable = nodeMapper.callToCallable(node.expression);
        if (!isSdsFunction(callable)) return;
        const funcName = callable.name;

        // insert the new split directly after the existing one, matching its indentation
        const indent = ' '.repeat(node.$cstNode.range.start.character);
        edits.push({
            range: { start: node.$cstNode.range.end, end: node.$cstNode.range.end },
            newText: `\n${indent}val rawValidation, val rawTest = ${restName}.${funcName}(0.5);`,
        });

        acceptor(
            createQuickfixFromTextEditsToSingleDocument(
                'Add a second split to partition the data into train, validation, and test sets.',
                diagnostic,
                document,
                edits,
                true,
            ),
        );
    };
};

/**
 * When an illegal split (splitting the training set) is detected within the pipeline,
 * correct this split by replacing the training set with the 'rest set' (other assignee)
 */
export const correctThreeWaySplit = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const analyzer = services.flow.DataFlowAnalyzer;

    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        // recover the illegal split assignment from the diagnostic path.
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data?.path);
        if (!isSdsAssignment(node)) return;

        // the diagnostic is on a direct split call: val ... = <dataset>.split(...).
        if (!analyzer.isSpecificCall(node, 'split') || !isSdsCall(node.expression)) return;
        const illegalSplitCall = node.expression;

        // walk the receiver chain down to the dataset being split (e.g. 'train' in 'train.splitRows(0.5)')
        let dataset: SdsExpression = illegalSplitCall.receiver;
        while (isSdsMemberAccess(dataset) || isSdsCall(dataset)) {
            dataset = dataset.receiver;
        }
        if (!isSdsReference(dataset) || !dataset.$cstNode) return;

        // get the placeholder referenced by the receiver
        const target = dataset.target.ref;
        if (!isSdsPlaceholder(target)) return;

        // the assignment that declared the referenced placeholder
        const source = AstUtils.getContainerOfType(target, isSdsAssignment);
        if (!source || !analyzer.isSpecificCall(source, 'split')) return;

        const restSet = getAssignees(source)[1];
        // already referencing the rest set, or no usable rest set -> nothing to correct
        if (!isSdsPlaceholder(restSet) || restSet === target) return;

        acceptor(
            createQuickfixFromTextEditsToSingleDocument(
                'Split the rest set instead, so the training set stays intact.',
                diagnostic,
                document,
                [{ range: dataset.$cstNode.range, newText: restSet.name }],
                true,
            ),
        );
    };
}