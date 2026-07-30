import {
  addDays,
  eachDay,
  type DailyCapacity,
  type SchedulerEntry,
  type SchedulerPerson,
  type SchedulerProject
} from "@flowkify/scheduler";

export interface DemoMetadata {
  seriesId?: string;
  occurrenceId?: string;
}

export interface DemoData {
  people: SchedulerPerson[];
  projects: SchedulerProject[];
  entries: SchedulerEntry<DemoMetadata>[];
  capacity: DailyCapacity[];
}

const firstNames = [
  "Ada",
  "Amir",
  "Elise",
  "Jonas",
  "Lina",
  "Maya",
  "Noah",
  "Robin",
  "Sam",
  "Sofia",
  "Theo",
  "Yara"
];
const lastNames = [
  "Bakker",
  "Claes",
  "De Smet",
  "Janssens",
  "Khan",
  "Lambert",
  "Peeters",
  "Vermeulen"
];

export const demoProjects: SchedulerProject[] = [
  {
    id: "atlas",
    name: "Atlas rollout",
    customerName: "Northwind",
    accentColor: "#4f6fca"
  },
  {
    id: "flow",
    name: "Workflow design",
    customerName: "Contoso",
    accentColor: "#7a5ca5"
  },
  {
    id: "studio",
    name: "Service studio",
    customerName: "Fabrikam",
    accentColor: "#398278"
  },
  {
    id: "internal",
    name: "Learning & development",
    customerName: "Internal",
    accentColor: "#8b6b45"
  }
];

function random(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function createDemoData(
  anchorDate: string,
  personCount = 42,
  entryCount = 420
): DemoData {
  const next = random(personCount * 100_000 + entryCount);
  const people = Array.from({ length: personCount }, (_, index) => ({
    id: `person-${index}`,
    name: `${firstNames[index % firstNames.length]} ${
      lastNames[Math.floor(index / firstNames.length) % lastNames.length]
    }`,
    secondaryText:
      index % 5 === 0
        ? "Solution architect"
        : index % 3 === 0
          ? "Consultant"
          : "Team member"
  }));
  const entries: SchedulerEntry<DemoMetadata>[] = [];
  const rangeStart = addDays(anchorDate, -50);
  for (let index = 0; index < entryCount; index += 1) {
    const person = people[Math.floor(next() * people.length)];
    const project =
      demoProjects[Math.floor(next() * demoProjects.length)] ?? demoProjects[0];
    if (!person || !project) continue;
    const startDate = addDays(rangeStart, Math.floor(next() * 110));
    const duration = 1 + Math.floor(next() * 6);
    entries.push({
      id: `entry-${index}`,
      personId: person.id,
      projectId: project.id,
      kind: "allocation",
      startDate,
      endDate: addDays(startDate, duration - 1),
      hoursPerDay: [2, 4, 6, 8][Math.floor(next() * 4)] ?? 4,
      title: project.name,
      ...(project.customerName ? { customerName: project.customerName } : {}),
      details:
        index % 7 === 0
          ? "Customer workshop, preparation and delivery"
          : "Planned project work",
      ...(index === 2
        ? {
            metadata: {
              seriesId: "weekly-team-series",
              occurrenceId: "occurrence-3"
            }
          }
        : {})
    });
  }
  for (let index = 0; index < Math.min(personCount, 24); index += 5) {
    const person = people[index];
    if (!person) continue;
    entries.push({
      id: `absence-${index}`,
      personId: person.id,
      kind: "absence",
      startDate: addDays(anchorDate, index % 10),
      endDate: addDays(anchorDate, (index % 10) + 1),
      hoursPerDay: 8,
      title: index % 2 ? "Training" : "Personal leave",
      readOnly: true,
      appearance: { variant: "striped" }
    });
  }
  const capacity = people.flatMap((person, personIndex) =>
    eachDay({
      startDate: addDays(anchorDate, -60),
      endDate: addDays(anchorDate, 60)
    }).map((date) => {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      return {
        personId: person.id,
        date,
        hours:
          day === 0 || day === 6 ? 0 : personIndex % 9 === 0 ? 6.4 : 8
      };
    })
  );
  return { people, projects: demoProjects, entries, capacity };
}
