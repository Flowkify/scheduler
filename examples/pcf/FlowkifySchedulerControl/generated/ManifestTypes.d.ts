/*
*This is auto generated from the ControlManifest.Input.xml file
*/

// Define IInputs and IOutputs Type. They should match with ControlManifest.
export interface IInputs {
    configuration: ComponentFramework.PropertyTypes.StringProperty;
    defaultView: ComponentFramework.PropertyTypes.EnumProperty<"0" | "1" | "2">;
    height: ComponentFramework.PropertyTypes.WholeNumberProperty;
}
export interface IOutputs {
    selectedEntryId?: string;
}
