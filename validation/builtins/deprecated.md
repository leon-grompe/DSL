# Validations from "deprecated.ts"

assigneeAssignedResultShouldNotBeDeprecated 
    node: SdsAssignee
    'warning', "The assigned result '${assignedObject.name}' is deprecated."
    CODE_DEPRECATED_LIBRARY_ELEMENT


annotationCallAnnotationShouldNotBeDeprecated 
    node: SdsAnnotationCall
    'warning', "The called annotation '${annotation.name}' is deprecated."
    CODE_DEPRECATED_LIBRARY_ELEMENT


argumentCorrespondingParameterShouldNotBeDeprecated 
    node: SdsArgument
    'warning', "The corresponding parameter '${parameter.name}' is deprecated."
    CODE_DEPRECATED_LIBRARY_ELEMENT


namedTypeDeclarationShouldNotBeDeprecated 
    node: SdsNamedType
    'warning', "The referenced declaration '${declaration.name}' is deprecated."
    CODE_DEPRECATED_LIBRARY_ELEMENT


referenceTargetShouldNotBeDeprecated
    node: SdsReference
    'warning', "The referenced declaration '${target.name}' is deprecated."
    CODE_DEPRECATED_LIBRARY_ELEMENT


requiredParameterMustNotBeDeprecated 
    node: SdsParameter
    'error', 'A deprecated parameter must be optional.'
    CODE_DEPRECATED_REQUIRED_PARAMETER


## Assessment
Not sure if possible. Maybe replace deprecated elements with non deprecated version?