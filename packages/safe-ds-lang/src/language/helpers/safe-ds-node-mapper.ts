import { AstNode, AstUtils, EMPTY_STREAM, Stream } from 'langium';
import {
    isSdsAbstractCall,
    isSdsAnnotationCall,
    isSdsAssignment,
    isSdsBlock,
    isSdsCall,
    isSdsCallable,
    isSdsChainedExpression,
    isSdsClass,
    isSdsEnumVariant,
    isSdsExpressionLambda,
    isSdsExpressionStatement,
    isSdsNamedType,
    isSdsOutputStatement,
    isSdsParameter,
    isSdsPlaceholder,
    isSdsReference,
    isSdsSegment,
    isSdsType,
    isSdsYield,
    SdsAbstractCall,
    SdsAbstractResult,
    SdsArgument,
    SdsAssignee,
    SdsCall,
    SdsCallable,
    SdsExpression,
    SdsLocalVariable,
    SdsParameter,
    SdsPlaceholder,
    SdsReference,
    SdsResult,
    SdsSegment,
    SdsStatement,
    SdsTypeArgument,
    SdsTypeParameter,
    SdsYield,
} from '../generated/ast.js';
import { SafeDsServices } from '../safe-ds-module.js';
import { CallableType, StaticType } from '../typing/model.js';
import { SafeDsTypeComputer } from '../typing/safe-ds-type-computer.js';
import {
    Argument,
    getAbstractResults,
    getArguments,
    getParameters,
    getTypeArguments,
    getTypeParameters,
    TypeArgument,
} from './nodeProperties.js';

export class SafeDsNodeMapper {
    private readonly typeComputer: () => SafeDsTypeComputer;

    constructor(services: SafeDsServices) {
        this.typeComputer = () => services.typing.TypeComputer;
    }

    /**
     * Returns the parameter that the argument is assigned to. If there is no matching parameter, returns `undefined`.
     */
    argumentToParameter(node: SdsArgument | undefined): SdsParameter | undefined {
        if (!node) {
            return undefined;
        }

        // Named argument
        if (node.parameter) {
            return node.parameter.ref;
        }

        // Positional argument
        const containingAbstractCall = AstUtils.getContainerOfType(node, isSdsAbstractCall)!;
        const args = getArguments(containingAbstractCall);
        const argumentPosition = node.$containerIndex ?? -1;

        // A prior argument is named
        for (let i = 0; i < argumentPosition; i++) {
            if (Argument.isNamed(args[i]!)) {
                return undefined;
            }
        }

        // Find parameter at the same position
        const callable = this.callToCallable(containingAbstractCall);
        const parameters = getParameters(callable);
        if (argumentPosition < parameters.length) {
            return parameters[argumentPosition];
        }

        return undefined;
    }

    /**
     * Returns the result, block lambda result, or expression that is assigned to the given assignee. If nothing is
     * assigned, `undefined` is returned.
     */
    assigneeToAssignedObject(node: SdsAssignee | undefined): SdsAbstractResult | SdsExpression | undefined {
        if (!node) {
            return undefined;
        }

        const containingAssignment = AstUtils.getContainerOfType(node, isSdsAssignment);
        /* c8 ignore start */
        if (!containingAssignment) {
            return undefined;
        }
        /* c8 ignore stop */

        const assigneePosition = node.$containerIndex ?? -1;
        const expression = containingAssignment.expression;

        // If the RHS is not a call, the first assignee gets the entire RHS
        if (!isSdsCall(expression)) {
            if (assigneePosition === 0) {
                return expression;
            } else {
                return undefined;
            }
        }

        // If the RHS instantiates a class or enum variant, the first assignee gets the entire RHS
        const callable = this.callToCallable(expression);
        if (isSdsClass(callable) || isSdsEnumVariant(callable)) {
            if (assigneePosition === 0) {
                return expression;
            } else {
                return undefined;
            }
        }

        // If the RHS calls an expression lambda, the first assignee gets its result
        if (isSdsExpressionLambda(callable)) {
            if (assigneePosition === 0) {
                return callable.result;
            } else {
                return undefined;
            }
        }

        // Otherwise, the assignee gets the result at the same position
        const abstractResults = getAbstractResults(callable);
        return abstractResults[assigneePosition];
    }

    /**
     * Returns the callable that is called by the given call. If no callable can be found, returns `undefined`.
     */
    callToCallable(node: SdsAbstractCall | undefined): SdsCallable | undefined {
        if (!node) {
            return undefined;
        }

        if (isSdsAnnotationCall(node)) {
            return node.annotation?.ref;
        } else if (isSdsCall(node)) {
            // We ignore nullability, since calls can be made null-safe. For scoping, for instance, we still want to
            // link the arguments of the call properly, even if the user forgot to make the call null-safe. In this
            // case, an error is being shown anyway.
            const receiverType = this.typeComputer().computeType(node.receiver);
            const nonNullableReceiverType = this.typeComputer().computeNonNullableType(receiverType);

            if (nonNullableReceiverType instanceof CallableType) {
                return nonNullableReceiverType.callable;
            } else if (nonNullableReceiverType instanceof StaticType) {
                const declaration = nonNullableReceiverType.instanceType.declaration;
                if (isSdsCallable(declaration)) {
                    return declaration;
                }
            }
        }

        return undefined;
    }

    /**
     * Returns the value that is assigned to the given parameter in the given call. This can be either the argument
     * value, or the parameter's default value if no argument is provided. If no value can be found, returns
     * `undefined`.
     *
     * @param call The call whose parameter value to return.
     * @param parameter The parameter whose value to return. Can be either a parameter itself or its name.
     */
    callToParameterValue(
        call: SdsAbstractCall | undefined,
        parameter: SdsParameter | string | undefined,
    ): SdsExpression | undefined {
        if (!call || !parameter) {
            return undefined;
        }

        // Parameter is set explicitly
        const argument = getArguments(call).find((it) => {
            if (isSdsParameter(parameter)) {
                return this.argumentToParameter(it) === parameter;
            } else {
                return this.argumentToParameter(it)?.name === parameter;
            }
        });
        if (argument) {
            return argument.value;
        }

        // Parameter is not set but might have a default value
        // We must ensure the parameter belongs to the called callable, so we cannot directly get the defaultValue
        const callable = this.callToCallable(call);
        return getParameters(callable).find((it) => {
            if (isSdsParameter(parameter)) {
                return it === parameter;
            } else {
                return it.name === parameter;
            }
        })?.defaultValue;
    }

    /**
     * Create a mapping from parameters to arguments. Parameters that are not mapped to an argument are not included in
     * the result. Neither are arguments that are not mapped to a parameter. If multiple arguments are mapped to the
     * same parameter, the first one wins.
     *
     * @param parameters The parameters to map to arguments.
     * @param args The arguments.
     */
    parametersToArguments(parameters: SdsParameter[], args: SdsArgument[]): Map<SdsParameter, SdsArgument> {
        const result = new Map<SdsParameter, SdsArgument>();

        for (const argument of args) {
            const parameterIndex = this.argumentToParameter(argument)?.$containerIndex ?? -1;
            if (parameterIndex === -1) {
                continue;
            }

            /*
             * argumentToParameter returns parameters of callable types. We have to remap this to parameter of the
             * actual callable.
             */
            const parameter = parameters[parameterIndex];
            if (!parameter) {
                continue;
            }

            // The first occurrence wins
            if (!result.has(parameter)) {
                result.set(parameter, argument);
            }
        }

        return result;
    }

    /**
     * Returns all references that target the given parameter.
     */
    parameterToReferences(node: SdsParameter | undefined): Stream<SdsReference> {
        if (!node) {
            return EMPTY_STREAM;
        }

        const containingCallable = AstUtils.getContainerOfType(node, isSdsCallable);
        /* c8 ignore start */
        if (!containingCallable) {
            return EMPTY_STREAM;
        }
        /* c8 ignore stop */

        return AstUtils.findLocalReferences(node, containingCallable)
            .map((it) => it.$refNode?.astNode)
            .filter(isSdsReference);
    }

    /**
     * Returns all references that target the given placeholder.
     */
    placeholderToReferences(node: SdsPlaceholder | undefined): Stream<SdsReference> {
        if (!node) {
            return EMPTY_STREAM;
        }

        const containingBlock = AstUtils.getContainerOfType(node, isSdsBlock);
        /* c8 ignore start */
        if (!containingBlock) {
            return EMPTY_STREAM;
        }
        /* c8 ignore stop */

        return AstUtils.findLocalReferences(node, containingBlock)
            .map((it) => it.$refNode?.astNode)
            .filter(isSdsReference);
    }

    /**
     * Uses either 'parameterToReferences' or 'placeholderToReferences' depending on the input to return all references that target the input local variable.
     */
    localVariableToReference(node: SdsLocalVariable | undefined): Stream<SdsReference> {
        if (!node) {
            return EMPTY_STREAM;
        }

        if (isSdsParameter(node)) {
            return this.parameterToReferences(node);
        } else if (isSdsPlaceholder(node)) {
            return this.placeholderToReferences(node);
        } else {
            return EMPTY_STREAM;
        }
    }

    /**
     * Returns all yields that assign to the given result.
     */
    resultToYields(node: SdsResult | undefined): Stream<SdsYield> {
        if (!node) {
            return EMPTY_STREAM;
        }

        const containingSegment = AstUtils.getContainerOfType(node, isSdsSegment);
        if (!containingSegment) {
            return EMPTY_STREAM;
        }

        return AstUtils.findLocalReferences(node, containingSegment)
            .map((it) => it.$refNode?.astNode)
            .filter(isSdsYield);
    }

    /**
     * Returns the assignee at the call site that corresponds to the given yield.
     * @param yieldStmt The yield to map.
     * @param callSiteAssignees The assignees at the call site.
     */
    yieldToCallSiteAssignee(
        yieldStmt: SdsYield, 
        callSiteAssignees: SdsAssignee[]
    ): SdsAssignee | undefined {
        const containingSegment = AstUtils.getContainerOfType(yieldStmt, isSdsSegment);
        if (!containingSegment) return undefined;

        const resultIndex = containingSegment.resultList?.results
            .findIndex(r => r === yieldStmt.result?.ref);
        if (resultIndex === undefined || resultIndex < 0) return undefined;

        return callSiteAssignees[resultIndex];
    }

    /**
     * Returns (yield statement, call-site assignee) pairs for each yield in the segment.
     * Yields whose result index has no corresponding call-site assignee are omitted.
     * CURRENTLY UNUSED
     */
    segmentToYieldAssigneeMap(
        segment: SdsSegment,
        callSiteAssignees: SdsAssignee[],
    ): Map<SdsYield, SdsAssignee> {
        const result = new Map<SdsYield, SdsAssignee>();
        AstUtils.streamAllContents(segment)
            .filter(isSdsYield)
            .toArray()
            .forEach((yieldStmt) => {
                const assignee = this.yieldToCallSiteAssignee(yieldStmt, callSiteAssignees);
                if (assignee) result.set(yieldStmt, assignee);
            });
        return result;
    }

    /**
     * Returns a map from each parameter of the call's callable to the corresponding argument expression.
     * Handles both positional and named arguments. Parameters with no matching argument are omitted.
     */
    callToParamArgMap(call: SdsCall): Map<SdsParameter, SdsArgument> {
        const callable = this.callToCallable(call);
        return this.parametersToArguments(getParameters(callable), getArguments(call));
    }

    /**
     * Returns the type parameter that the type argument is assigned to. If there is no matching type parameter, returns
     * `undefined`.
     */
    typeArgumentToTypeParameter(node: SdsTypeArgument | undefined): SdsTypeParameter | undefined {
        if (!node) {
            return undefined;
        }

        // Named type argument
        if (node.typeParameter) {
            return node.typeParameter.ref;
        }

        // Positional type argument
        const containingType = AstUtils.getContainerOfType(node, isSdsType);
        if (!isSdsNamedType(containingType)) {
            return undefined;
        }

        const typeArguments = getTypeArguments(containingType.typeArgumentList);
        const typeArgumentPosition = node.$containerIndex ?? -1;

        // A prior type argument is named
        for (let i = 0; i < typeArgumentPosition; i++) {
            if (TypeArgument.isNamed(typeArguments[i]!)) {
                return undefined;
            }
        }

        // Find type parameter at the same position
        const namedTypeDeclaration = containingType.declaration?.ref;
        const typeParameters = getTypeParameters(namedTypeDeclaration);
        return typeParameters[typeArgumentPosition];
    }

    /**
     * Returns all calls that are being made by the given statement, if any.
     * If no call can be found, returns an empty array.
     * For chained expressions, all calls in the chain are returned (from innermost to outermost).
     *
     * @param statement The statement to extract calls from.
     * @returns An array of all calls in the statement, or an empty array if none found.
     */
    statementToCalls(
        statement: SdsStatement, 
        paramArgMap: Map<SdsParameter, SdsExpression> = new Map()
    ): { call: SdsCall, paramArgMap: Map<SdsParameter, SdsExpression> }[] {
        if (isSdsExpressionStatement(statement) ||
            isSdsAssignment(statement) ||
            isSdsOutputStatement(statement)) {

            const directCalls = AstUtils.streamAst(statement.expression as AstNode)
                .filter(isSdsCall)
                .toArray();
            directCalls.reverse();

            const result: { call: SdsCall, paramArgMap: Map<SdsParameter, SdsExpression> }[] = [];

            for (const call of directCalls) {
                const callable = this.callToCallable(call);

                if (isSdsSegment(callable)) {
                    // Build param->arg map for this segment call
                    const segmentParams = getParameters(callable);
                    const segmentArgs = getArguments(call);
                    const segmentParamArgMap = this.parametersToArguments(segmentParams, segmentArgs);
                    
                    // Resolve each param's argument expression, substituting outer bindings if needed
                    const resolvedMap = new Map<SdsParameter, SdsExpression>();
                    for (const [param, arg] of segmentParamArgMap) {
                        let expr = arg.value;
                        // If the argument is a reference to a parameter in the outer map, resolve it
                        if (isSdsReference(expr) && isSdsParameter(expr.target.ref)) {
                            const outerExpr = paramArgMap.get(expr.target.ref);
                            if (outerExpr) expr = outerExpr;
                        }
                        resolvedMap.set(param, expr);
                    }

                    for (const segmentStatement of callable.body.statements) {
                        result.push(...this.statementToCalls(segmentStatement, resolvedMap));
                    }
                } else {
                    result.push({ call, paramArgMap });
                }
            }

            return result;
        }
        return [];
    }
}
