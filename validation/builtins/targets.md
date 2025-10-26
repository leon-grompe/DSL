# Validations from "targets.ts"

targetsShouldNotHaveDuplicateEntries 
    node: SdsAnnotation
    'warning', "The target '${evaluatedTarget.variant.name}' was set already."
    CODE_TARGETS_DUPLICATE_TARGET


annotationCallMustHaveCorrectTarget 
    node: SdsAnnotationCall
    'error', "The annotation '${annotation.name}' cannot be applied to ${actualTarget.prettyName}."
    CODE_TARGETS_WRONG_TARGET


## Assessment
Probably not possible