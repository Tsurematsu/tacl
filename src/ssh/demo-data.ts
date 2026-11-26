import type { Device, HeadscaleUser, ServerConfig, TaclState } from "../types/model.ts";

export function createDemoEnvironment(): {
  server: ServerConfig;
  users: HeadscaleUser[];
  devices: Device[];
  state: TaclState;
  existingPolicyRaw: string;
} {
  const server: ServerConfig = {
    hostAlias: "oracle (DEMO)",
    hostName: "100.64.0.1",
    user: "ubuntu",
    isLocal: true,
    deployMode: "container",
    policyMode: "file",
    containerRuntime: "docker",
    containerName: "headscale",
    containerDir: "/opt/headscale",
    configPath: "/opt/headscale/config.yaml",
    aclPath: "/opt/headscale/acl.hujson",
    taclStatePath: "/opt/headscale/tacl.yaml",
  };

  const users: HeadscaleUser[] = [
    { id: "u-personal", name: "personal" },
    { id: "u-trabajo", name: "trabajo" },
    { id: "u-servidores", name: "servidores" },
  ];

  const devices: Device[] = [
    {
      id: "dev-portatil",
      name: "portatil",
      givenName: "portatil",
      userId: "u-personal",
      userName: "personal",
      ipAddresses: ["100.64.0.10"],
      online: true,
      tags: [],
    },
    {
      id: "dev-celular",
      name: "celular",
      givenName: "celular",
      userId: "u-personal",
      userName: "personal",
      ipAddresses: ["100.64.0.11"],
      online: true,
      tags: [],
    },
    {
      id: "dev-tv",
      name: "tv-sala",
      givenName: "tv-sala",
      userId: "u-personal",
      userName: "personal",
      ipAddresses: ["100.64.0.12"],
      online: false,
      tags: [],
    },
    {
      id: "dev-oracle",
      name: "oracle",
      givenName: "oracle",
      userId: "u-servidores",
      userName: "servidores",
      ipAddresses: ["100.64.0.1"],
      online: true,
      tags: [],
    },
    {
      id: "dev-nas",
      name: "nas-casa",
      givenName: "nas-casa",
      userId: "u-servidores",
      userName: "servidores",
      ipAddresses: ["100.64.0.2"],
      online: true,
      tags: [],
    },
    {
      id: "dev-work-pc",
      name: "pc-oficina",
      givenName: "pc-oficina",
      userId: "u-trabajo",
      userName: "trabajo",
      ipAddresses: ["100.64.0.20"],
      online: true,
      tags: [],
    },
  ];

  const state: TaclState = {
    version: 1,
    initialized: true,
    defaultPolicy: "deny",
    profiles: [
      {
        id: "prof-admins",
        name: "Admins",
        deviceIds: ["dev-portatil", "dev-celular"],
      },
      {
        id: "prof-infra",
        name: "Infraestructura",
        deviceIds: ["dev-oracle", "dev-nas"],
      },
    ],
    rules: [
      // User rules
      {
        id: "rule-u1",
        scope: "user",
        sourceId: "u-personal",
        targetId: "u-personal",
        direction: "both",
        protocol: "both",
        ports: ["*"],
      },
      // Profile rules
      {
        id: "rule-p1",
        scope: "profile",
        sourceId: "prof-admins",
        targetId: "prof-infra",
        direction: "a_to_b",
        protocol: "tcp",
        ports: ["22", "443"],
      },
      // Device rules (absolute weight)
      {
        id: "rule-d1",
        scope: "device",
        sourceId: "dev-tv",
        targetId: "dev-portatil",
        direction: "deny",
        protocol: "both",
        ports: ["*"],
      },
      {
        id: "rule-d2",
        scope: "device",
        sourceId: "dev-portatil",
        targetId: "dev-nas",
        direction: "both",
        protocol: "both",
        ports: ["*"],
      },
    ],
    conflictResolutions: [],
  };

  const existingPolicyRaw = `{
  // Política existente de ejemplo en Headscale
  "acls": [
    { "action": "accept", "src": ["*"], "dst": ["*:*"] }
  ]
}
`;

  return { server, users, devices, state, existingPolicyRaw };
}
