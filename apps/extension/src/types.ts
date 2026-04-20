export type Config = {
  id: string
  label: string
  origin: string
  projectKey: string
  intakeEndpoint: string
  createdAt: number
}

export type ConfigInput = Omit<Config, "id" | "createdAt">
