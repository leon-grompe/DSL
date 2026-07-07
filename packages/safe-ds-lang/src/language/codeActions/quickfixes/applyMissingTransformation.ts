import { Diagnostic } from 'vscode-languageserver';
import { AstUtils, LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsAssignment, isSdsCall, isSdsClass, isSdsFunction, isSdsPipeline, isSdsPlaceholder, SdsCall, SdsPipeline } from '../../generated/ast.js';
import { DataSet } from '../../flow/safe-ds-dataset-identifier.js';
import { getAssignees } from '../../helpers/nodeProperties.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';
import { createQuickfixFromTextEditsToSingleDocument } from '../factories.js';

/**
 * When a transformation is applied to one dataset partition but missing entirely on another, replicate
 * the same transformation onto the partition that lacks it. The source statement is copied verbatim, with
 * its source-partition input swapped for the most specific placeholder of the target partition, so e.g.
 * 'val x = trainImputed.transformTable(encoder)' yields 'val y = testImputed.transformTable(encoder)'.
 *
 * Only the "entirely missing on one partition" case is handled (one side applies the transformation, the
 * other never does); a differing-but-nonzero count is ambiguous and left for the user.
 */
export const applyMissingTransformation = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const identifier = services.flow.DatasetIdentifier;

    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        const data = diagnostic.data;
        if (!data?.path) return;

        // the diagnostic path points at the source transformation call
        const call = locator.getAstNode(document.parseResult.value, data.path);
        if (!isSdsCall(call)) return;

        // determine which partition has the transformation (source) and which lacks it (target).
        // only the case where one side has a count of zero is unambiguously fixable by adding one line.
        const referenceDataset = data.referenceDataset as DataSet;
        const deviatingDataset = data.deviatingDataset as DataSet;
        const referenceCount = data.referenceCount as number;
        const deviatingCount = data.deviatingCount as number;

        let sourceDataset: DataSet;
        let targetDataset: DataSet;
        if (deviatingCount === 0 && referenceCount > 0) {
            sourceDataset = referenceDataset;
            targetDataset = deviatingDataset;
        } else if (referenceCount === 0 && deviatingCount > 0) {
            sourceDataset = deviatingDataset;
            targetDataset = referenceDataset;
        } else {
            return;
        }

        const pipeline = AstUtils.getContainerOfType(call, isSdsPipeline);
        if (!pipeline?.body) return;
        const statements = pipeline.body.statements;

        // the assignment holding the source transformation; must be a pipeline-level statement
        // (a call inlined from a segment is not something we can replicate at the pipeline level)
        const assignment = AstUtils.getContainerOfType(call, isSdsAssignment);
        if (!assignment?.$cstNode || !assignment.expression?.$cstNode || !statements.includes(assignment)) return;

        // the transformation must assign to exactly one placeholder, so the replicated line has a clear output
        const assignees = getAssignees(assignment);
        if (assignees.length !== 1 || !isSdsPlaceholder(assignees[0])) return;

        // the reference in the source call derived from the source partition (its receiver base or data argument)
        const sourceReference = identifier.findDatasetReferenceInCall(call, statements, sourceDataset);
        if (!sourceReference?.$cstNode) return;

        // the most specific placeholder of the target partition available before the source statement,
        // so the replicated transformation chains onto the target's latest derived form
        const targetPlaceholder = identifier.getMostSpecificDatasetPlaceholder(statements, targetDataset, assignment);
        if (!targetPlaceholder) return;

        // copy the source right-hand side, swapping only the source-partition input for the target one
        const rhs = assignment.expression.$cstNode;
        const relativeStart = sourceReference.$cstNode.offset - rhs.offset;
        const relativeEnd = relativeStart + sourceReference.$cstNode.length;
        // insert the new placeholder
        const newRhs = rhs.text.slice(0, relativeStart) + targetPlaceholder.name + rhs.text.slice(relativeEnd);

        const callName = callableName(call, services);
        const newName = `${targetDataset.toLowerCase()}${capitalize(callName)}`;

        // insert the replicated statement right after the source one, matching its indentation
        const indent = ' '.repeat(assignment.$cstNode.range.start.character);
        acceptor(
            createQuickfixFromTextEditsToSingleDocument(
                `Apply '${callName}' to the ${targetDataset.toLowerCase()} set ('${targetPlaceholder.name}') as well.`,
                diagnostic,
                document,
                [
                    {
                        range: { start: assignment.$cstNode.range.end, end: assignment.$cstNode.range.end },
                        newText: `\n${indent}val ${newName} = ${newRhs};`,
                    },
                ],
                true,
            ),
        );
    };
};

/**
 * Returns the name of the callable a call resolves to, or 'transformation' if it cannot be named.
 */
const callableName = (call: SdsCall, services: SafeDsServices): string => {
    const callable = services.helpers.NodeMapper.callToCallable(call);
    return isSdsFunction(callable) || isSdsClass(callable) ? callable.name : 'transformation';
};

/**
 * Capitalize the first letter.
 */
const capitalize = (value: string): string => {
    return (value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1));
};