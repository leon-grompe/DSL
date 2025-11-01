import { Diagnostic, TextEdit } from 'vscode-languageserver';
import { LangiumDocument } from 'langium';
import { SafeDsServices } from '../../safe-ds-module.js';
import { isSdsCall, SdsArgument } from '../../generated/ast.js';
import { Parameter, getArguments, getParameters, Argument } from '../../helpers/nodeProperties.js';
import { SafeDsNodeMapper } from '../../helpers/safe-ds-node-mapper.js';
import { CodeActionAcceptor } from '../safe-ds-code-action-provider.js';
import { createQuickfixFromTextEditsToSingleDocument } from '../factories.js';

export const setCallArgumentToUpperParameterBound = (services: SafeDsServices) => {
}

export const setCallArgumentToLowerParameterBound = (services: SafeDsServices) => {
    const locator = services.workspace.AstNodeLocator;
    const partialEvaluator = services.evaluation.PartialEvaluator;
    const nodeMapper = services.helpers.NodeMapper;

    return (diagnostic: Diagnostic, document: LangiumDocument, acceptor: CodeActionAcceptor) => {
        const node = locator.getAstNode(document.parseResult.value, diagnostic.data.path);
        
        if (!isSdsCall(node)) {
            /* c8 ignore next 2 */
            return;
        }
        const argList = node.argumentList

        acceptor(
            createQuickfixFromTextEditsToSingleDocument(
                'Set argument to lower parameter bound.',
                diagnostic,
                document,
                argList.arguments.flatMap((it) => setToParameterBounds(nodeMapper, it)),
                true,
            ),
        );
    }
}

const setToParameterBounds = (nodeMapper: SafeDsNodeMapper, argument: SdsArgument): TextEdit[] | TextEdit => {
    const cstNode = argument.$cstNode;
    
    const param = nodeMapper.argumentToParameter(argument);
    const paramBounds = Parameter.getBounds(param);
    
    if (!cstNode || paramBounds.length === 0) {
        return [];
    }
    
    // what if upper bound?
    // what if multiple bounds?
    const result = [];
    for (const bound of paramBounds) {
        if (!bound.leftOperand || !bound.rightOperand.$cstNode || !param)
            return[]
        
        if (bound.operator == '>'){
            const rightOp = bound.rightOperand.$cstNode?.text;
            const newRightOp = parseInt(rightOp) +1;

            const edit: TextEdit = {  
                range: cstNode.range,
                newText: `${param.name} = ${newRightOp}`,
                }
            result.push(edit);
        }
        if (bound.operator == '>='){
            const edit: TextEdit = {  
                range: cstNode.range,
                newText: `${param.name} = ${bound.rightOperand.$cstNode?.text}`,
                }
            result.push(edit);
        }
    }

    return result
}
/*
const substitutions = partialEvaluator.computeParameterSubstitutionsForCall(node);

for (const argument of getArguments(node)) {
    const value = partialEvaluator.evaluate(argument.value);
    if (!(value instanceof Constant)) {
        continue;
    }

    const parameter = nodeMapper.argumentToParameter(argument);
    if (!parameter) {
        continue;
    }

    for (const bound of Parameter.getBounds(parameter)) {
        const rightOperand = partialEvaluator.evaluate(bound.rightOperand, substitutions);
        const messageEvaluatedNode = partialEvaluator.evaluate(bound.message, substitutions);
        const customMessage =
            messageEvaluatedNode instanceof StringConstant ? messageEvaluatedNode.value : undefined;

        const error = checkBound(parameter.name, value, bound.operator, rightOperand, customMessage);
        if (error) {
            accept('error', error, {
                node: argument,
                property: 'value',
                code: CODE_PARAMETER_BOUND_INVALID_VALUE,
            });
        }
    }
};*/