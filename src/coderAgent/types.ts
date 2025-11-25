export interface ProjectFile {
    path: string;
    content: string;
}

export interface Project {
    files: ProjectFile[];
    summary?: string;
}
