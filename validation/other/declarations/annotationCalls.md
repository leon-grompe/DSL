# Validations from "annotationCalls.ts"

annotationCallArgumentsMustBeConstant 
    node: SdsAnnotationCall
    'error', 'Values assigned to annotation parameters must be constant.'
    CODE_ANNOTATION_CALL_CONSTANT_ARGUMENT


annotationCallMustNotLackArgumentList 
    node: SdsAnnotationCall
    'error', `The annotation '${node.annotation?.$refText}' has required parameters, so an argument list must be added.'
    CODE_ANNOTATION_CALL_MISSING_ARGUMENT_LIST


callableTypeParametersMustNotBeAnnotated 
    node: SdsCallableType
    'error', 'Parameters of callable types must not be annotated.'
    CODE_ANNOTATION_CALL_TARGET_PARAMETER


callableTypeResultsMustNotBeAnnotated 
    node: SdsCallableType
    'error', 'Results of callable types must not be annotated.'
    CODE_ANNOTATION_CALL_TARGET_RESULT


lambdaParametersMustNotBeAnnotated 
    node: SdsLambda
    'error', 'Lambda parameters must not be annotated.'
    CODE_ANNOTATION_CALL_TARGET_PARAMETER


## Assessment
Possible