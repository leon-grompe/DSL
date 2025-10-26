# Validations from "references.ts"

referenceMustNotBeFunctionPointer 
    node: SdsReference
    'error', 'Function pointers are not allowed to provide a cleaner graphical view. Use a lambda instead.'
    CODE_REFERENCE_FUNCTION_POINTER


referenceMustNotBeStaticClassOrEnumReference 
    node: SdsReference
    'error', 'A class must not be statically referenced.'
    CODE_REFERENCE_STATIC_CLASS_REFERENCE
    -
    'error', 'An enum must not be statically referenced.'
    CODE_REFERENCE_STATIC_ENUM_REFERENCE


referenceTargetMustNotBeAnnotationPipelineOrTypeAlias 
    node: SdsReference
    'error', 'An annotation must not be the target of a reference.'
    CODE_REFERENCE_TARGET
    -
    'error', 'A pipeline must not be the target of a reference.'
    CODE_REFERENCE_TARGET
    -
    'error', 'A type alias must not be the target of a reference.'
    CODE_REFERENCE_TARGET


## Assessment
Not sure whats helpful here