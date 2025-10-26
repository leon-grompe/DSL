# Validations from "types.ts"

## Type checking
argumentTypesMustMatchParameterTypes 
    node: SdsAbstractCall
    'error', "Expected type '${parameterType}' but got '${argumentType}'."
    CODE_TYPE_MISMATCH


callReceiverMustBeCallable 
    node: SdsCall
    'error', 'This expression is not callable.'
    CODE_TYPE_CALLABLE_RECEIVER
    -
    'error', 'Cannot instantiate a class that has no constructor.'
    CODE_TYPE_CALLABLE_RECEIVER


indexedAccessReceiverMustHaveCorrectType 
    node: SdsIndexedAccess
    'error', "Indexed access is not defined for type '${receiverType}'."
    CODE_TYPE_MISMATCH


indexedAccessIndexMustHaveCorrectType 
    node: SdsIndexedAccess
    'error', "Expected type '${coreTypes.Int}' but got '${indexType}'."
    CODE_TYPE_MISMATCH
    -
    'error', "Expected type '${coreTypes.String}' but got '${indexType}'."
    CODE_TYPE_MISMATCH
    -
    'error', "Expected type '${keyType}' but got '${indexType}'."
    CODE_TYPE_MISMATCH


infixOperationOperandsMustHaveCorrectType 
    node: SdsInfixOperation
    'error', "This operator is not defined for type '${leftType}'."
    CODE_TYPE_MISMATCH
    -
    'error', "This operator is not defined for type '${rightType}'."
    CODE_TYPE_MISMATCH
    -
    'error', "Use template strings for concatenation."
    CODE_TYPE_MISMATCH


listMustNotContainNamedTuples 
    node: SdsList
    'error', "Cannot add a value of type '${elementType}' to a list."
    CODE_TYPE_MISMATCH


mapMustNotContainNamedTuples 
    node: SdsMap
    'error', "Cannot use a value of type '${keyType}' as a map key."
    CODE_TYPE_MISMATCH
    -
    'error', "Cannot use a value of type '${valueKey}' as a map value."
    CODE_TYPE_MISMATCH


namedTypeTypeArgumentsMustMatchBounds 
    node: SdsNamedType
    'error', "Expected type '${upperBound}' but got '${typeArgumentType}'."
    CODE_TYPE_MISMATCH


parameterDefaultValueTypeMustMatchParameterType
    node: SdsParameter
    'error', "Expected type '${parameterType}' but got '${defaultValueType}'."
    CODE_TYPE_MISMATCH


prefixOperationOperandMustHaveCorrectType 
    node: SdsPrefixOperation
    'error', "This operator is not defined for type '${operandType}'."
    CODE_TYPE_MISMATCH
    -
    'error', "This operator is not defined for type '${operandType}'."
    CODE_TYPE_MISMATCH


typeCastMustNotAlwaysFail 
    node: SdsTypeCast
    'error', 'This type cast can never succeed.'
    CODE_TYPE_MISMATCH


typeParameterDefaultValueMustMatchUpperBound
    node: SdsTypeParameter
    'error', "Expected type '${upperBoundType}' but got '${defaultValueType}'."
    CODE_TYPE_MISMATCH


yieldTypeMustMatchResultType 
    node: SdsYield
    'error', "Expected type '${resultType}' but got '${yieldType}'."
    CODE_TYPE_MISMATCH


## Missing type arguments
namedTypeMustSetAllTypeParameters 
    node: SdsNamedType
    'error', "The ${kind} ${missingTypeParametersString} must be set here."
    CODE_TYPE_MISSING_TYPE_ARGUMENTS
    -
    'error', "The type '${node.declaration?.$refText}' has required type parameters, so a type argument list must be added."
    CODE_TYPE_MISSING_TYPE_ARGUMENTS


## Missing type hints
attributeMustHaveTypeHint
    node: SdsAttribute
    'error', 'An attribute must have a type hint.'
    CODE_TYPE_MISSING_TYPE_HINT


parameterMustHaveTypeHint 
    node: SdsParameter
    'error', 'A parameter must have a type hint.'
    CODE_TYPE_MISSING_TYPE_HINT


resultMustHaveTypeHint 
    node: SdsResult
    'error', 'A result must have a type hint.'
    CODE_TYPE_MISSING_TYPE_HINT


## Assessment
Probably mostly possible?