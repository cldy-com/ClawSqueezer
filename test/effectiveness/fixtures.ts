/**
 * Synthetic conversation fixtures for effectiveness testing.
 * Realistic patterns, no real data.
 */

/** A coding session: user asks to build something, agent uses tools */
export function codingSession(turns: number = 12): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];

  // Turn 1: user asks to build a REST API
  msgs.push({ role: "user", content: "Build me a simple REST API with Express that has CRUD endpoints for a todo list. Use TypeScript." });

  // Turn 2: agent reads existing files
  msgs.push({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "I need to check if there's an existing project structure first." },
      { type: "toolCall", id: "tc_1", name: "exec", input: { command: "ls -la && cat package.json 2>/dev/null || echo 'no package.json'" } },
    ],
  });
  msgs.push({
    role: "toolResult",
    toolCallId: "tc_1",
    content: [{ type: "text", text: "total 4\ndrwxr-xr-x 2 user user 4096 Mar 10 12:00 .\ndrwxr-xr-x 3 user user 4096 Mar 10 11:59 ..\nno package.json" }],
  });

  // Turn 3: agent creates project
  msgs.push({
    role: "assistant",
    content: [
      { type: "text", text: "I'll set up the project from scratch." },
      { type: "toolCall", id: "tc_2", name: "exec", input: { command: "npm init -y && npm install express typescript @types/express @types/node ts-node" } },
    ],
  });
  msgs.push({
    role: "toolResult",
    toolCallId: "tc_2",
    content: [{
      type: "text",
      text: "Wrote to /workspace/package.json:\n{\n  \"name\": \"todo-api\",\n  \"version\": \"1.0.0\"\n}\n\nadded 48 packages in 4.2s\n\n" + "npm warn deprecated ".repeat(20) + "\n" + "x".repeat(2000),
    }],
  });

  // Turn 4: agent writes the main file (large tool call input)
  const serverCode = `
import express from 'express';
const app = express();
app.use(express.json());

interface Todo { id: number; title: string; done: boolean; }
let todos: Todo[] = [];
let nextId = 1;

app.get('/todos', (req, res) => res.json(todos));
app.post('/todos', (req, res) => {
  const todo: Todo = { id: nextId++, title: req.body.title, done: false };
  todos.push(todo);
  res.status(201).json(todo);
});
app.put('/todos/:id', (req, res) => {
  const todo = todos.find(t => t.id === Number(req.params.id));
  if (!todo) return res.status(404).json({ error: 'Not found' });
  todo.title = req.body.title ?? todo.title;
  todo.done = req.body.done ?? todo.done;
  res.json(todo);
});
app.delete('/todos/:id', (req, res) => {
  todos = todos.filter(t => t.id !== Number(req.params.id));
  res.status(204).send();
});

app.listen(3000, () => console.log('Server running on port 3000'));
`.trim();

  msgs.push({ role: "user", content: "looks good, go ahead" });
  msgs.push({
    role: "assistant",
    content: [
      { type: "toolCall", id: "tc_3", name: "write", input: { path: "src/server.ts", content: serverCode } },
    ],
  });
  msgs.push({
    role: "toolResult",
    toolCallId: "tc_3",
    content: [{ type: "text", text: "Successfully wrote 847 bytes to src/server.ts" }],
  });

  // Turn 5: agent writes tsconfig (another large tool call)
  msgs.push({
    role: "assistant",
    content: [
      { type: "toolCall", id: "tc_4", name: "write", input: {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2020", module: "commonjs", outDir: "./dist",
            rootDir: "./src", strict: true, esModuleInterop: true,
            skipLibCheck: true, forceConsistentCasingInFileNames: true,
            resolveJsonModule: true, declaration: true, declarationMap: true,
            sourceMap: true,
          },
          include: ["src/**/*"],
          exclude: ["node_modules", "dist", "test"],
        }, null, 2),
      }},
    ],
  });
  msgs.push({
    role: "toolResult",
    toolCallId: "tc_4",
    content: [{ type: "text", text: "Successfully wrote 412 bytes to tsconfig.json" }],
  });

  // Turn 6: run tests, get output
  msgs.push({ role: "user", content: "now run it and test the endpoints" });
  msgs.push({
    role: "assistant",
    content: [
      { type: "toolCall", id: "tc_5", name: "exec", input: { command: "npx ts-node src/server.ts &\nsleep 2\ncurl -s localhost:3000/todos\ncurl -s -X POST localhost:3000/todos -H 'Content-Type: application/json' -d '{\"title\":\"Buy groceries\"}'\ncurl -s localhost:3000/todos" } },
    ],
  });
  msgs.push({
    role: "toolResult",
    toolCallId: "tc_5",
    content: [{
      type: "text",
      text: "Server running on port 3000\n[]\n{\"id\":1,\"title\":\"Buy groceries\",\"done\":false}\n[{\"id\":1,\"title\":\"Buy groceries\",\"done\":false}]",
    }],
  });

  // Turn 7: agent confirms
  msgs.push({
    role: "assistant",
    content: [{ type: "text", text: "API is running and all CRUD endpoints work:\n- GET /todos → returns list\n- POST /todos → creates todo\n- PUT /todos/:id → updates todo\n- DELETE /todos/:id → removes todo\n\nWant me to add tests or any other features?" }],
  });

  // Add more filler turns if requested
  for (let i = 7; i < turns; i++) {
    msgs.push({ role: "user", content: `Follow-up question ${i}: can you add feature ${i}?` });
    msgs.push({
      role: "assistant",
      content: [{ type: "text", text: `Sure, here's how feature ${i} would work. ${"Details about the implementation. ".repeat(10)}` }],
    });
  }

  return msgs;
}

/** A session with images (screenshots, diagrams) */
export function imageSession(): Record<string, unknown>[] {
  return [
    { role: "user", content: "Here's a screenshot of the error" },
    {
      role: "user",
      content: [
        { type: "text", text: "Check this screenshot:" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" + "A".repeat(5000) } },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "I can see the error. It's a TypeError: Cannot read properties of undefined. The issue is on line 42 where you're accessing `user.profile.name` but `user.profile` is null." }],
    },
    { role: "user", content: "ok fix it" },
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "tc_img_1", name: "edit", input: { path: "src/app.ts", old_string: "user.profile.name", new_string: "user.profile?.name ?? 'Anonymous'" } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "tc_img_1",
      content: [{ type: "text", text: "Successfully edited src/app.ts" }],
    },
    { role: "user", content: "now it works, thanks" },
    { role: "assistant", content: [{ type: "text", text: "Great! The optional chaining (`?.`) prevents the crash when profile is null." }] },
    // More recent turns to make the image stale
    { role: "user", content: "what else should I improve?" },
    { role: "assistant", content: [{ type: "text", text: "I'd recommend adding input validation and error handling middleware." }] },
    { role: "user", content: "show me how" },
    { role: "assistant", content: [{ type: "text", text: "Here's a basic error handler:\n\n```typescript\napp.use((err, req, res, next) => {\n  console.error(err.stack);\n  res.status(500).json({ error: 'Internal server error' });\n});\n```" }] },
    { role: "user", content: "anything else?" },
  ];
}

/** A session with mixed tool types (exec, read, write) and an aborted call */
export function mixedToolSession(): Record<string, unknown>[] {
  return [
    { role: "user", content: "Deploy the app to production" },
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "tc_m1", name: "exec", input: { command: "docker build -t myapp:latest ." } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "tc_m1",
      content: [{
        type: "text",
        text: "Step 1/8 : FROM node:22-slim\n ---> abc123\nStep 2/8 : WORKDIR /app\n" +
          "Step 3/8 : COPY package*.json ./\nStep 4/8 : RUN npm ci\n" +
          "added 148 packages in 12s\n".repeat(5) +
          "Step 5/8 : COPY . .\nStep 6/8 : RUN npm run build\n" +
          "tsc output line\n".repeat(30) +
          "Step 7/8 : EXPOSE 3000\nStep 8/8 : CMD [\"node\", \"dist/server.js\"]\n" +
          "Successfully built def456\nSuccessfully tagged myapp:latest",
      }],
    },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Docker image built. Now pushing to registry." },
        { type: "toolCall", id: "tc_m2", name: "exec", input: { command: "docker push registry.example.com/myapp:latest" } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "tc_m2",
      content: [{ type: "text", text: "The push refers to repository [registry.example.com/myapp]\nlatest: digest: sha256:abcdef123456 size: 2847" }],
    },
    { role: "user", content: "now update the kubernetes deployment" },
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "tc_m3", name: "read", input: { path: "k8s/deployment.yaml" } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "tc_m3",
      content: [{
        type: "text",
        text: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: myapp\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: myapp\n  template:\n    metadata:\n      labels:\n        app: myapp\n    spec:\n      containers:\n      - name: myapp\n        image: registry.example.com/myapp:v1.2.3\n        ports:\n        - containerPort: 3000\n        resources:\n          requests:\n            memory: \"128Mi\"\n            cpu: \"250m\"\n          limits:\n            memory: \"256Mi\"\n            cpu: \"500m\"",
      }],
    },
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "tc_m4", name: "edit", input: {
          path: "k8s/deployment.yaml",
          old_string: "image: registry.example.com/myapp:v1.2.3",
          new_string: "image: registry.example.com/myapp:latest",
        }},
      ],
    },
    {
      role: "toolResult",
      toolCallId: "tc_m4",
      content: [{ type: "text", text: "Successfully edited k8s/deployment.yaml" }],
    },
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "tc_m5", name: "exec", input: { command: "kubectl apply -f k8s/deployment.yaml && kubectl rollout status deployment/myapp" } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "tc_m5",
      content: [{
        type: "text",
        text: "deployment.apps/myapp configured\nWaiting for deployment \"myapp\" rollout to finish: 1 out of 3 new replicas have been updated...\nWaiting for deployment \"myapp\" rollout to finish: 2 out of 3 new replicas have been updated...\ndeployment \"myapp\" successfully rolled out",
      }],
    },
    { role: "user", content: "check if it's healthy" },
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "tc_m6", name: "exec", input: { command: "kubectl get pods -l app=myapp && curl -s http://myapp.internal/health" } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "tc_m6",
      content: [{
        type: "text",
        text: "NAME                     READY   STATUS    RESTARTS   AGE\nmyapp-7d4f8b6c9-abc12   1/1     Running   0          45s\nmyapp-7d4f8b6c9-def34   1/1     Running   0          42s\nmyapp-7d4f8b6c9-ghi56   1/1     Running   0          38s\n{\"status\":\"healthy\",\"uptime\":43,\"version\":\"latest\"}",
      }],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "All 3 pods are running and healthy. Deployment complete! 🚀" }],
    },
    // Recent turns
    { role: "user", content: "great, what about the database migration?" },
    { role: "assistant", content: [{ type: "text", text: "We should run the migration before routing traffic. Let me check the migration files." }] },
    { role: "user", content: "go ahead" },
    { role: "assistant", content: [{ type: "text", text: "Running migration now..." }] },
    { role: "user", content: "status?" },
  ];
}
