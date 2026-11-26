import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { createDemoEnvironment } from "../src/ssh/demo-data.ts";
import { MainLayout } from "../src/tui/screens/MainLayout.tsx";
import { SetupWizard } from "../src/tui/screens/SetupWizard.tsx";
import { SudoPasswordModal } from "../src/tui/modals/SudoPasswordModal.tsx";

describe("MainLayout TUI integration", () => {
  test("renders tabs, opens u/p/l/f/^X modals, and blocks edits on Conexiones Directas", async () => {
    const demo = createDemoEnvironment();
    const { renderOnce, captureCharFrame, mockInput, renderer } = await testRender(
      <MainLayout
        server={demo.server}
        initialUsers={demo.users}
        initialDevices={demo.devices}
        initialState={demo.state}
        initialPolicyRaw={demo.existingPolicyRaw}
        isDemo={true}
        onRescan={() => {}}
        onExit={() => {}}
      />,
      { width: 120, height: 36 }
    );

    const press = async (fn: () => void, waitMs = 0) => {
      await act(async () => {
        fn();
        if (waitMs > 0) {
          await Bun.sleep(waitMs);
        }
      });
      await renderOnce();
    };

    try {
      await renderOnce();
      const initial = captureCharFrame();
      expect(initial).toContain("[1] Dispositivos");
      expect(initial).toContain("[2] Perfiles");
      expect(initial).toContain("[3] Usuarios");
      expect(initial).toContain("[4] Conexiones Directas");
      expect(initial).toContain("🛡 SSH:22 (portatil→oracle)");
      expect(initial).toContain("tv-sala");
      expect(initial).toContain("portatil");

      // Open (a) ItemsPanelModal on Dispositivos
      await press(() => mockInput.pressKey("a"));
      expect(captureCharFrame()).toContain("Todos los Dispositivos (6)");
      await press(() => mockInput.pressKey("a"));

      // Open (a) ItemsPanelModal on Perfiles, open edit (e), and verify Esc returns to ItemsPanelModal
      await press(() => mockInput.pressKey("2"));
      await press(() => mockInput.pressKey("a"));
      expect(captureCharFrame()).toContain("Todos los Perfiles (2)");
      await press(() => mockInput.pressKey("e"));
      expect(captureCharFrame()).toContain("Editar Perfil (f)");
      await press(() => mockInput.pressEscape(), 60);
      expect(captureCharFrame()).toContain("Todos los Perfiles (2)");
      await press(() => mockInput.pressEscape(), 60);

      // Open (a) ItemsPanelModal on Usuarios
      await press(() => mockInput.pressKey("3"));
      await press(() => mockInput.pressKey("a"));
      expect(captureCharFrame()).toContain("Todos los Usuarios de Headscale (3)");
      await press(() => mockInput.pressEscape(), 60);

      // Back to tab 1
      await press(() => mockInput.pressKey("1"));

      // Test (Space) QuickConnectModal 3-step wizard: Origen -> Destino -> Dir/Proto/Ports checklist + custom port
      await press(() => mockInput.pressKey(" "));
      expect(captureCharFrame()).toContain("Origen — Dispositivos (Paso 1/3)");
      await press(() => mockInput.pressEnter());
      expect(captureCharFrame()).toContain("Destino — Dispositivos (Paso 2/3)");
      await press(() => mockInput.pressEnter());
      const step3Frame = captureCharFrame();
      expect(step3Frame).toContain("Configurar Regla (Paso 3/3)");
      expect(step3Frame).toContain("22 — SSH");
      expect(step3Frame).toContain("8000-8080");

      // Add a custom port range with (a)
      await press(() => mockInput.pressKey("a"));
      await press(() => mockInput.pressKey("9"));
      await press(() => mockInput.pressKey("0"));
      await press(() => mockInput.pressKey("0"));
      await press(() => mockInput.pressKey("0"));
      await press(() => mockInput.pressEnter());
      expect(captureCharFrame()).toContain("9000 — Puerto personalizado");

      // Esc steps back through Destino -> Origen -> Close
      await press(() => mockInput.pressEscape(), 60);
      expect(captureCharFrame()).toContain("Destino — Dispositivos (Paso 2/3)");
      await press(() => mockInput.pressEscape(), 60);
      expect(captureCharFrame()).toContain("Origen — Dispositivos (Paso 1/3)");
      await press(() => mockInput.pressEscape(), 60);

      // Open (u) EditConnectionModal
      await press(() => mockInput.pressKey("u"));
      expect(captureCharFrame()).toContain("Editar Conexión (u)");
      await press(() => mockInput.pressEscape(), 60);

      // Open (p) PortsModal
      await press(() => mockInput.pressKey("p"));
      expect(captureCharFrame()).toContain("Puertos Permitidos (p)");
      await press(() => mockInput.pressEscape(), 60);

      // Open (l) LinkModal
      await press(() => mockInput.pressKey("l"));
      expect(captureCharFrame()).toContain("Ligar (l)");
      await press(() => mockInput.pressEscape(), 60);

      // Open (f) ProfileModal and test user filter (Tab -> right arrow) + (a) toggle all filtered devices
      await press(() => mockInput.pressKey("f"));
      expect(captureCharFrame()).toContain("Crear Nuevo Perfil (f)");
      expect(captureCharFrame()).toContain("Filtro usuario [←/→]");
      await press(() => mockInput.pressTab());
      await press(() => mockInput.pressArrow("right")); // filter to "personal" (3 devices)
      const filteredProfFrame = captureCharFrame();
      expect(filteredProfFrame).toContain('mostrando 3 de "personal"');
      expect(filteredProfFrame).toContain("portatil");
      expect(filteredProfFrame).not.toContain("pc-oficina");
      // Press (a) to select all 3 devices of "personal"
      await press(() => mockInput.pressKey("a"));
      expect(captureCharFrame()).toContain("3 seleccionados en total");
      // Press (a) again to deselect all 3 devices of "personal"
      await press(() => mockInput.pressKey("a"));
      expect(captureCharFrame()).toContain("0 seleccionados en total");
      // Press (o) to hide devices already belonging to another profile (portatil & celular are in Admins -> only tv-sala left!)
      await press(() => mockInput.pressKey("o"));
      const hiddenAssignedFrame = captureCharFrame();
      expect(hiddenAssignedFrame).toContain("Sin perfil (2 ocultos)");
      expect(hiddenAssignedFrame).toContain("tv-sala");
      expect(hiddenAssignedFrame).not.toContain("celular");
      // Press (o) again to show all again
      await press(() => mockInput.pressKey("o"));
      expect(captureCharFrame()).toContain('mostrando 3 de "personal"');
      await press(() => mockInput.pressEscape(), 60);

      // Open (^X) DeleteModal
      await press(() => mockInput.pressKey("x", { ctrl: true }));
      expect(captureCharFrame()).toContain("Eliminar Reglas / Ligamientos (^X)");
      await press(() => mockInput.pressEscape(), 60);

      // Switch to tab 4 (Conexiones Directas) and verify origin grouping + dropdown expand + read-only block
      await press(() => mockInput.pressKey("4"));
      const directFrame = captureCharFrame();
      expect(directFrame).toContain("Regla activa");
      expect(directFrame).toContain("destinos");

      // Press Enter on first origin group header to expand its destinations dropdown
      await press(() => mockInput.pressEnter());
      const expandedDirect = captureCharFrame();
      expect(expandedDirect).toContain("├─");
      expect(expandedDirect).toContain("└─");

      // Collapse again with Enter
      await press(() => mockInput.pressEnter());
      expect(captureCharFrame()).not.toContain("├─");

      // Press (g) to ungroup (flat view) and verify group headers disappear; press (g) again to re-group
      await press(() => mockInput.pressKey("g"));
      const ungroupedFrame = captureCharFrame();
      expect(ungroupedFrame).not.toContain("destinos (");
      expect(ungroupedFrame).toContain("[g] Agrupar");
      await press(() => mockInput.pressKey("g"));
      expect(captureCharFrame()).toContain("[g] Desagrupar");

      await press(() => mockInput.pressKey("u"));
      const blockedFrame = captureCharFrame();
      expect(blockedFrame).toContain("solo lectura");
      expect(blockedFrame).not.toContain("Editar Conexión (u)");

      await press(() => mockInput.pressKey("x", { ctrl: true }));
      expect(captureCharFrame()).not.toContain("Eliminar Reglas / Ligamientos (^X)");

      // Verify (a) is excluded on Conexiones Directas
      await press(() => mockInput.pressKey("a"));
      expect(captureCharFrame()).not.toContain("Todos los Dispositivos");
      expect(captureCharFrame()).not.toContain("Todos los Perfiles");
      expect(captureCharFrame()).not.toContain("Todos los Usuarios");

      // Back to tab 1: try creating a DENY rule on protected pair (portatil -> oracle) via Space wizard -> must be blocked!
      await press(() => mockInput.pressKey("1"));
      await press(() => mockInput.pressKey(" ")); // Origen: portatil (idx 0)
      await press(() => mockInput.pressEnter()); // -> Destino (starts at idx 1 = celular)
      await press(() => mockInput.pressArrow("down")); // tv-sala (idx 2)
      await press(() => mockInput.pressArrow("down")); // oracle (idx 3)
      await press(() => mockInput.pressEnter()); // -> Step 3 (Dir starts at both = idx 0)
      await press(() => mockInput.pressArrow("left")); // wraps to deny (idx 3)
      // attempt save -> guarded!
      await press(() => mockInput.pressEnter());
      expect(captureCharFrame()).toContain("Conexión SSH protegida");
    } finally {
      renderer.destroy();
    }
  });

  test("SetupWizard lets user choose Automatic vs Manual (server + SSH user)", async () => {
    const { renderOnce, captureCharFrame, mockInput, renderer } = await testRender(
      <SetupWizard onComplete={() => {}} onExit={() => {}} />,
      { width: 120, height: 34 }
    );

    const press = async (fn: () => void, waitMs = 0) => {
      await act(async () => {
        fn();
        if (waitMs > 0) await Bun.sleep(waitMs);
      });
      await renderOnce();
    };

    try {
      await renderOnce();
      const startFrame = captureCharFrame();
      expect(startFrame).toContain("Detección Automática");
      expect(startFrame).toContain("Selección Manual (Servidor y Usuario SSH)");

      // Select Manual option
      await press(() => mockInput.pressArrow("down"));
      await press(() => mockInput.pressEnter(), 120);
      const manualFrame = captureCharFrame();
      expect(manualFrame).toContain("Conexión Manual (Servidor y Usuario SSH)");
      expect(manualFrame).toContain("Usuario SSH");
      expect(manualFrame).toContain("Disponibles");

      // Open server dropdown with Space, verify localhost is listed, and pick it with Enter
      await press(() => mockInput.pressKey(" "));
      const dropdownFrame = captureCharFrame();
      expect(dropdownFrame).toContain("Servidores disponibles");
      expect(dropdownFrame).toContain("localhost");
      await press(() => mockInput.pressEnter());
      expect(captureCharFrame()).toContain("localhost");

      // Type user in field 2 (focus moved automatically after selecting from dropdown)
      await press(() => mockInput.typeText("ubuntu"));
      const typedFrame = captureCharFrame();
      expect(typedFrame).toContain("ubuntu");

      // Esc returns cleanly to Auto vs Manual choice
      await press(() => mockInput.pressEscape(), 60);
      expect(captureCharFrame()).toContain("Detección Automática");
    } finally {
      renderer.destroy();
    }
  });

  test("SudoPasswordModal masks password characters and submits value cleanly", async () => {
    let submitted = "";
    const { renderOnce, captureCharFrame, mockInput, renderer } = await testRender(
      <SudoPasswordModal
        hostLabel="ubuntu@oracle"
        reason="Se requiere sudo para escribir /etc/headscale/acl.hujson"
        onSubmit={(pwd) => {
          submitted = pwd;
        }}
        onCancel={() => {}}
      />,
      { width: 100, height: 24 }
    );

    const press = async (fn: () => void) => {
      await act(async () => {
        fn();
      });
      await renderOnce();
    };

    try {
      await renderOnce();
      await press(() => mockInput.typeText("miClave"));
      const frame = captureCharFrame();
      expect(frame).toContain("•••••••");
      expect(frame).not.toContain("miClave");
      await press(() => mockInput.pressEnter());
      expect(submitted).toBe("miClave");
    } finally {
      renderer.destroy();
    }
  });
});
