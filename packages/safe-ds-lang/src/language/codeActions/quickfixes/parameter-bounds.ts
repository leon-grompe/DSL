import { Diagnostic, TextEdit } from 'vscode-languageserver';
import { LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsCall, SdsArgument, SdsParameterBound } from '../../generated/ast.js';
import { getArguments, Parameter } from '../../helpers/nodeProperties.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';
import { createQuickfixFromTextEditsToSingleDocument } from '../factories.js';
import { EvaluatedNode } from '../../partialEvaluation/model.js';

interface BoundInfo {
    upper: { operator: string; rightOp: EvaluatedNode; bound: SdsParameterBound } | null;
    lower: { operator: string; rightOp: EvaluatedNode; bound: SdsParameterBound } | null;
}

/**
 * Creates one Quickfix for all arguments with only single bounds violated,
 * and separate Quickfixes for arguments with both upper and lower bounds violated.
 * It currently does not differentiate between int and float adjustments.
 * Might need to remove functionality for floats in the future.
 */
export const setArgumentsToParameterBounds = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const nodeMapper = services.helpers.NodeMapper;
    const partialEvaluator = services.evaluation.PartialEvaluator;

    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data?.path);
        
        if (!isSdsCall(node)) {
            return;
        }
        
        const substitutions = partialEvaluator.computeParameterSubstitutionsForCall(node);
        
        // Store bound information and violations per argument
        const argBoundsMap = new Map<SdsArgument, BoundInfo>();
        const argViolationsMap = new Map<SdsArgument, { edit: TextEdit; isSingleBound: boolean }>();

        // Phase 1: Collect all bounds and identify violations
        for (const arg of getArguments(node)) {
            const cstNode = arg.$cstNode;
            if (!cstNode) {
                continue;
            }

            const param = nodeMapper.argumentToParameter(arg);
            if (!param) {
                continue;
            }

            const bounds = Parameter.getBounds(param);
            if (bounds.length === 0) {
                continue;
            }

            const leftOp = partialEvaluator.evaluate(arg.value, substitutions);
            const boundInfo: BoundInfo = { upper: null, lower: null };
            let hasViolation = false;
            let firstViolationReplacement: string | undefined;

            // Categorize bounds and check violations
            for (const bound of bounds) {
                const rightOp = partialEvaluator.evaluate(bound.rightOperand, substitutions);
                const operator = bound.operator;

                // Categorize bound
                if (operator === '<' || operator === '<=') {
                    boundInfo.upper = { operator, rightOp, bound };
                } else if (operator === '>' || operator === '>=') {
                    boundInfo.lower = { operator, rightOp, bound };
                }

                // Check violation and store first viable replacement
                if (!checkBound(leftOp, operator, rightOp)) {
                    hasViolation = true;
                    if (firstViolationReplacement === undefined) {
                        firstViolationReplacement = computeReplacementFromBound(operator, rightOp);
                    }
                }
            }

            // Store bound info for this argument
            argBoundsMap.set(arg, boundInfo);

            // Store violation info if there is one
            if (hasViolation && firstViolationReplacement !== undefined) {
                const hasBothBounds = boundInfo.upper !== null && boundInfo.lower !== null;
                argViolationsMap.set(arg, {
                    edit: { range: cstNode.range, newText: firstViolationReplacement },
                    isSingleBound: !hasBothBounds
                });
            }
        }

        // Phase 2: Generate quickfixes for arguments with both bounds
        for (const [arg, boundInfo] of argBoundsMap.entries()) {
            // Only generate if there's a violation and both bounds exist
            if (!argViolationsMap.has(arg)) {
                continue;
            }

            if (boundInfo.upper && boundInfo.lower) {
                const cstNode = arg.$cstNode;
                if (!cstNode) {
                    continue;
                }

                const upperReplacement = computeReplacementFromBound(boundInfo.upper.operator, boundInfo.upper.rightOp);
                const lowerReplacement = computeReplacementFromBound(boundInfo.lower.operator, boundInfo.lower.rightOp);

                if (lowerReplacement !== undefined) {
                    acceptor(
                        createQuickfixFromTextEditsToSingleDocument(
                            `Set argument ${nodeMapper.argumentToParameter(arg)?.name} to its lower bound ${lowerReplacement}`,
                            diagnostic,
                            document,
                            [{ range: cstNode.range, newText: lowerReplacement }],
                            true,
                        ),
                    );
                }

                if (upperReplacement !== undefined) {
                    acceptor(
                        createQuickfixFromTextEditsToSingleDocument(
                            `Set argument ${nodeMapper.argumentToParameter(arg)?.name} to its upper bound ${lowerReplacement}`,
                            diagnostic,
                            document,
                            [{ range: cstNode.range, newText: upperReplacement }],
                            true,
                        ),
                    );
                }
            }
        }

        // Phase 3: Collect edits for the general quickfix (only single-bound arguments)
        const simpleEdits: TextEdit[] = [];
        for (const [arg, violation] of argViolationsMap.entries()) {
            if (violation.isSingleBound) {
                simpleEdits.push(violation.edit);
            }
        }

        // Phase 4: Generate general quickfix if there are any single-bound violations
        if (simpleEdits.length > 0) {
            acceptor(
                createQuickfixFromTextEditsToSingleDocument(
                    'Set arguments to values that satisfy parameter bounds',
                    diagnostic,
                    document,
                    simpleEdits,
                    true,
                ),
            );
        }
    };
};

/**
 * Check if a value satisfies a bound constraint
 */
const checkBound = (leftOp: EvaluatedNode, operator: string, rightOp: EvaluatedNode): boolean => {
    switch (operator) {
        case '<':
            return leftOp < rightOp;
        case '<=':
            return leftOp <= rightOp;
        case '>':
            return leftOp > rightOp;
        case '>=':
            return leftOp >= rightOp;
        default:
            return false;
    }
};

/**
 * Compute a replacement value that satisfies the bound
 */
const computeReplacementFromBound = (operator: string, rightOp: EvaluatedNode): string | undefined => {
    const rightValue = rightOp.toString();
    const numericValue = Number(rightValue);
    
    // Check if we can parse as number for adjustment
    const isNumeric = !isNaN(numericValue) && isFinite(numericValue);

    switch (operator) {
        case '<':
            return isNumeric ? String(Math.floor(numericValue) - 1) : undefined;
        case '<=':
            return rightValue;
        case '>':
            return isNumeric ? String(Math.floor(numericValue) + 1) : undefined;
        case '>=':
            return rightValue;
        default:
            return undefined;
    }
};