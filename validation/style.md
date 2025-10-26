# Validations from "style.ts"

## Unnecessary argument lists
annotationCallArgumentListShouldBeNeeded 
    node: SdsAnnotationCall
    'info', 'This argument list can be removed.'
    CODE_STYLE_UNNECESSARY_ARGUMENT_LIST


callArgumentListShouldBeNeeded 
    node: SdsCall
    'info', 'This argument list can be removed.'
    CODE_STYLE_UNNECESSARY_ARGUMENT_LIST


## Unnecessary assignments
assignmentShouldHaveMoreThanWildcardsAsAssignees 
    node: SdsAssignment
    'info', 'This assignment can be replaced by an expression statement.'
    CODE_STYLE_UNNECESSARY_ASSIGNMENT


## Unnecessary bodies
classBodyShouldNotBeEmpty 
    node: SdsClassBody
    'info', 'This body can be removed.'
    CODE_STYLE_UNNECESSARY_BODY


enumBodyShouldNotBeEmpty 
    node: SdsEnumBody
    'info', 'This body can be removed.'
    CODE_STYLE_UNNECESSARY_BODY


## Unnecessary const modifier
annotationParameterShouldNotHaveConstModifier 
    node: SdsAnnotation
    'info', 'Annotation parameters are always const, so this modifier can be removed.'
    CODE_STYLE_UNNECESSARY_CONST_MODIFIER


## Unnecessary constraint lists
constraintListShouldNotBeEmpty 
    node: SdsConstraintList
    'info', 'This constraint list can be removed.'
    CODE_STYLE_UNNECESSARY_CONSTRAINT_LIST


## Unnecessary elvis operator
elvisOperatorShouldBeNeeded
    node: SdsInfixOperation
    'info', 'The left operand is never null, so the elvis operator is unnecessary (keep the left operand).'
    CODE_STYLE_UNNECESSARY_ELVIS_OPERATOR
    -
    'info', 'Both operands are always null, so the elvis operator is unnecessary (replace it with null).'
    CODE_STYLE_UNNECESSARY_ELVIS_OPERATOR
    -
    'info', 'The left operand is always null, so the elvis operator is unnecessary (keep the right operand).'
    CODE_STYLE_UNNECESSARY_ELVIS_OPERATOR
    -
    'info', 'The right operand is always null, so the elvis operator is unnecessary (keep the left operand).'
    CODE_STYLE_UNNECESSARY_ELVIS_OPERATOR


## Unnecessary import alias
importedDeclarationAliasShouldDifferFromDeclarationName 
    node: SdsImportedDeclaration
    'info', 'This alias can be removed.'
    CODE_STYLE_UNNECESSARY_IMPORT_ALIAS


## Unnecessary null safety
chainedExpressionNullSafetyShouldBeNeeded 
    node: SdsChainedExpression
    'info', 'The receiver is never null, so null-safety is unnecessary.'
    CODE_STYLE_UNNECESSARY_NULL_SAFETY


## Unnecessary parameter lists
annotationParameterListShouldNotBeEmpty 
    node: SdsAnnotation
    'info', 'This parameter list can be removed.'
    CODE_STYLE_UNNECESSARY_PARAMETER_LIST


enumVariantParameterListShouldNotBeEmpty 
    node: SdsEnumVariant
    'info', 'This parameter list can be removed.'
    CODE_STYLE_UNNECESSARY_PARAMETER_LIST


## Unnecessary result lists
functionResultListShouldNotBeEmpty 
    node: SdsFunction
    'info', 'This result list can be removed.'
    CODE_STYLE_UNNECESSARY_RESULT_LIST


segmentResultListShouldNotBeEmpty 
    node: SdsSegment
    'info', 'This result list can be removed.'
    CODE_STYLE_UNNECESSARY_RESULT_LIST


## Unnecessary type argument lists
namedTypeTypeArgumentListShouldBeNeeded 
    node: SdsNamedType
    info', 'This type argument list can be removed.'
    CODE_STYLE_UNNECESSARY_TYPE_ARGUMENT_LIST


## Unnecessary type parameter lists
typeParameterListShouldNotBeEmpty 
    node: SdsTypeParameterList
    'info', 'This type parameter list can be removed.'
    CODE_STYLE_UNNECESSARY_TYPE_PARAMETER_LIST


## Unnecessary type parameter lists
unionTypeShouldNotHaveASingularTypeArgument 
    node: SdsUnionType
    'info', 'This can be replaced by the singular type argument of the union type.'
    CODE_STYLE_UNNECESSARY_UNION_TYPE


## Assessment
Seems like pretty much all are possible