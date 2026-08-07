import * as React from "react";
import type { IInputs, IOutputs } from "./generated/ManifestTypes";
import { DataverseSchedulerRepository } from "./DataverseSchedulerRepository";
import { parseDefaultView } from "./configuration";
import {
  FlowkifySchedulerHost,
  type FlowkifySchedulerHostProps
} from "./FlowkifySchedulerHost";

export class SchedulerControl
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private notifyOutputChanged!: () => void;
  private repository?: DataverseSchedulerRepository;
  private selectedEntryId?: string;

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void
  ): void {
    this.notifyOutputChanged = notifyOutputChanged;
    this.repository = new DataverseSchedulerRepository(context);
    context.mode.trackContainerResize(true);
  }

  public updateView(
    context: ComponentFramework.Context<IInputs>
  ): React.ReactElement {
    this.repository ??= new DataverseSchedulerRepository(context);
    this.repository.setContext(context);
    const configuredHeight = context.parameters.height.raw;
    const height = Math.max(
      480,
      configuredHeight || context.mode.allocatedHeight || 680
    );
    const props: FlowkifySchedulerHostProps = {
      repository: this.repository,
      height,
      defaultZoom: parseDefaultView(context.parameters.defaultView.raw),
      onProjectOpenInDataverse: async (projectId) => {
        await context.navigation.openForm({
          entityName: "flowkify_project",
          entityId: projectId,
          openInNewWindow: true
        });
      },
      onEntrySelected: (entryId) => {
        this.selectedEntryId = entryId;
        this.notifyOutputChanged();
      }
    };
    return React.createElement(FlowkifySchedulerHost, props);
  }

  public getOutputs(): IOutputs {
    return this.selectedEntryId
      ? { selectedEntryId: this.selectedEntryId }
      : {};
  }

  public destroy(): void {
    this.repository = undefined;
  }
}

