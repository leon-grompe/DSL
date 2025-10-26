# Validations from "inheritance.ts"

classMemberMustMatchOverriddenMemberAndShouldBeNeeded
    node: SdsClassMember
    'error', `Overriding member does not match the overridden member:'
    CODE_INHERITANCE_IDENTICAL_TO_OVERRIDDEN_MEMBER
    -
    'info', 'Overriding member is identical to overridden member and can be removed.'
    CODE_INHERITANCE_INCOMPATIBLE_TO_OVERRIDDEN_MEMBER


classMustOnlyInheritASingleClass
    node: SdsClass
    'error', 'A class must only inherit classes.'
    CODE_INHERITANCE_NOT_A_CLASS
    -
    'error', 'The parent type must not be nullable.'
    CODE_INHERITANCE_NULLABLE
    -
    'error', 'Multiple inheritance is not supported. Only the first parent type will be considered.'
    CODE_INHERITANCE_MULTIPLE_INHERITANCE


classMustNotInheritItself 
    node: SdsClass
    'error', 'A class must not directly or indirectly be a subtype of itself.'
    CODE_INHERITANCE_CYCLE


overridingAndOverriddenMethodsMustNotHavePythonMacro 
    node: SdsFunction
    'error', "An overriding method must not call the '@PythonMacro' annotation."
    CODE_INHERITANCE_PYTHON_MACRO
    -
    'error', "Cannot override a method that calls the '@PythonMacro' annotation."
    CODE_INHERITANCE_PYTHON_MACRO


overridingMemberPythonNameMustMatchOverriddenMember 
    node: SdsClassMember
    'error', 'The Python name must match the overridden member.'
    CODE_INHERITANCE_PYTHON_NAME


## Assessment
Probably all not relevant, since we concentrate on the DSL language which does not support classes