import { exec } from '@actions/exec';
import type {
  Dependency,
  EcosystemSupport,
  Project,
  RootProject,
} from '@xeel-dev/cli/ecosystem-support';
import { readdir, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

const ECOSYSTEM_NAME = 'PYTHON';

type PythonProject = Project<typeof ECOSYSTEM_NAME>;
type PythonRootProject = RootProject<typeof ECOSYSTEM_NAME>;
type PythonDependency = Dependency<typeof ECOSYSTEM_NAME>;

interface PyPiRelease {
  upload_time: string;
  yanked: boolean;
}

const PROJECT_MARKER_FILES = ['requirements.txt', 'pyproject.toml'];

export default class PythonEcosystemSupport
  implements EcosystemSupport<typeof ECOSYSTEM_NAME>
{
  get name(): typeof ECOSYSTEM_NAME {
    return ECOSYSTEM_NAME;
  }
  /**
   * Finds any directories containing a requirements.txt file.
   * @returns {Promise<PythonRootProject[]>}
   */
  async findProjects(
    dir = process.cwd(),
    depth = 0,
  ): Promise<PythonRootProject[]> {
    // Recursive search for requirements.txt files,
    // then return the directory containing them
    const projects: PythonRootProject[] = [];
    if (depth > 3) return projects;
    for (const file of await readdir(dir)) {
      const filePath = join(dir, file);
      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        projects.push(...(await this.findProjects(filePath, depth + 1)));
      } else if (PROJECT_MARKER_FILES.includes(file) && !projects.some((p) => p.path === dir)) {
        projects.push({
          ecosystem: ECOSYSTEM_NAME,
          name: dir.split(sep).pop() || dir,
          path: dir,
          subProjects: [],
        });
      }
    }

    return projects;
  }

  private async getPyPiRelease(
    deps: PythonDependency[],
    outdatedDeps: PythonDependency[],
  ): Promise<void> {
    // Look up each dependency in the pypi API to get the release date info
    for (const dep of deps) {
      if (dep.current.date) continue;
      const res = await fetch(`https://pypi.org/pypi/${dep.name}/json`);
      if (!res.ok && res.status === 429) {
        console.warn(`Rate limited by pypi API, retrying in 5 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return this.getPyPiRelease(deps, outdatedDeps);
      }
      if (res.ok) {
        try {
          const data = await res.json();
          const releaseDates = Object.entries(data.releases);
          const latestEntry = releaseDates.find(
            ([key]) => key === dep.latest.version,
          );
          const currentEntry = releaseDates.find(
            ([key]) => key === dep.current.version,
          );
          if (!latestEntry || !currentEntry) {
            console.warn(
              `Failed to find release date for ${dep.name} in pypi response`,
            );
            continue;
          }
          const latestRelease = (latestEntry[1] as PyPiRelease[])[0];
          const currentRelease = (currentEntry[1] as PyPiRelease[])[0];
          dep.latest.date = new Date(latestRelease.upload_time);
          dep.current.date = new Date(currentRelease.upload_time);
          dep.latest.isDeprecated = latestRelease.yanked;
          dep.current.isDeprecated = currentRelease.yanked;
        } catch (e) {
          console.error(`Failed to parse pypi response for ${dep.name}: ${e}`);
        }
      } else {
        console.warn(
          `Failed to fetch release date for ${dep.name}: ${res.statusText}`,
        );
      }
    }
    // Only include dependencies with release date info
    outdatedDeps.push(...deps.filter((dep) => dep.latest.date));
  }

  async listOutdatedDependencies(
    project: PythonProject,
  ): Promise<PythonDependency[]> {
    const outdatedDeps: PythonDependency[] = [];
    await exec('pip', ['list', '--outdated', '--format', 'json'], {
      cwd: project.path,
      listeners: {
        stdout: async (data: Buffer) => {
          try {
            const outdated = JSON.parse(data.toString());
            const deps: PythonDependency[] = outdated.map((dep: any) => ({
              name: dep.name,
              type: 'PROD',
              ecosystem: ECOSYSTEM_NAME,
              current: { version: dep.version },
              latest: { version: dep.latest_version },
            }));
            await this.getPyPiRelease(deps, outdatedDeps);
          } catch (e) {
            if (e instanceof Error) {
              console.error(`Failed to parse pip list output: ${e.message}`);
            } else {
              console.error('Failed to parse pip list output');
            }
          }
        },
      },
    });
    return outdatedDeps;
  }
}
