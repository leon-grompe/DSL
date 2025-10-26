# Validations from "experimental.ts"

assigneeAssignedResultShouldNotBeExperimental 
    node: SdsAssignee
    'warning', "The assigned result '${assignedObject.name}' is experimental."
    CODE_EXPERIMENTAL_LIBRARY_ELEMENT


annotationCallAnnotationShouldNotBeExperimental 
    node: SdsAnnotationCall
    'warning', "The called annotation '${annotation.name}' is experimental."
    CODE_EXPERIMENTAL_LIBRARY_ELEMENT


argumentCorrespondingParameterShouldNotBeExperimental 
    node: SdsArgument
    'warning', "The corresponding parameter '${parameter.name}' is experimental."
    CODE_EXPERIMENTAL_LIBRARY_ELEMENT


namedTypeDeclarationShouldNotBeExperimental 
    node: SdsNamedType
    'warning', "The referenced declaration '${declaration.name}' is experimental."
    CODE_EXPERIMENTAL_LIBRARY_ELEMENT


referenceTargetShouldNotExperimental 
    node: SdsReference
    'warning', "The referenced declaration '${target.name}' is experimental."
    CODE_EXPERIMENTAL_LIBRARY_ELEMENT


## Assessment
I think it would be possible? Need to look into experimental