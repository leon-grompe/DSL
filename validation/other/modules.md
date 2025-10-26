# Validations from "modules.ts"

moduleDeclarationsMustMatchFileKind 
    node: SdsModule
    'error', 'A pipeline file must only declare pipelines and segments.'
    CODE_MODULE_FORBIDDEN_IN_PIPELINE_FILE
    -
    'error', 'A stub file must not declare pipelines or segments.'
    CODE_MODULE_FORBIDDEN_IN_STUB_FILE


moduleWithDeclarationsMustStatePackage 
    node: SdsModule
    'error', 'A module with declarations must state its package.'
    CODE_MODULE_MISSING_PACKAGE


pipelineFileMustNotBeInBuiltinPackage 
    node: SdsModule
    'error', "A pipeline file must not be in a '${SAFEDS_ROOT_PACKAGE}' package."
    CODE_MODULE_PIPELINE_FILE_IN_BUILTIN_PACKAGE


## Assessment
MustMatchFileKind unsure
MustStatePackage probably possible (?) Need to find package name
MustNotBeInBuiltinPackage probably not possible