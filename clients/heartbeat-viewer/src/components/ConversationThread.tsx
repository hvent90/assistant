import { useState, memo } from "react"
import { Streamdown } from "streamdown"
import { projectThread } from "llm-gateway/packages/ai/client"
import type { ViewNode, ViewContent, Graph } from "llm-gateway/packages/ai/client"
import type { ContentPart } from "llm-gateway/packages/ai/types"

interface ConversationThreadProps {
  graph: Graph
}

interface MessageGroup {
  runId: string
  role: "user" | "assistant"
  nodes: ViewNode[]
}

function groupNodes(nodes: ViewNode[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const node of nodes) {
    const last = groups[groups.length - 1]
    if (last && last.runId === node.runId) {
      last.nodes.push(node)
    } else {
      groups.push({ runId: node.runId, role: node.role, nodes: [node] })
    }
  }
  return groups
}

function ContentView({ content }: { content: ViewContent }) {
  switch (content.kind) {
    case "user":
      return (
        <div className="mt-1 whitespace-pre-wrap">
          {typeof content.content === "string"
            ? content.content
            : (content.content as ContentPart[])
                .filter((p) => p.type === "text")
                .map((p) => (p as { type: "text"; text: string }).text)
                .join("\n")}
        </div>
      )
    case "text":
      return (
        <div className="mt-1 streamdown">
          <Streamdown>{content.text}</Streamdown>
        </div>
      )
    case "reasoning":
      return (
        <div className="mt-1 text-sm italic text-neutral-500 streamdown">
          <Streamdown>{content.text}</Streamdown>
        </div>
      )
    case "error":
      return (
        <div className="mt-1 border border-neutral-700 p-2 text-sm text-red-400">
          {content.message}
        </div>
      )
    case "tool_call":
      return <ToolCallView content={content} />
    case "relay":
    case "pending":
      return null
  }
}

function CollapsiblePre({
  label,
  text,
  className,
}: {
  label: string
  text: string
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const oneLine = text.replace(/\n/g, " ").replace(/\s+/g, " ")

  return (
    <div className="mt-1">
      <div className="flex w-full items-start gap-1 text-left">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 text-neutral-600 hover:text-white"
        >
          {expanded ? "\u25BC" : "\u25B6"}
        </button>
        {expanded ? (
          <pre
            className={`whitespace-pre-wrap break-words select-text ${className ?? "text-neutral-400"}`}
          >
            {text}
          </pre>
        ) : (
          <span
            className={`cursor-pointer truncate font-mono ${className ?? "text-neutral-400"}`}
            onClick={() => {
              const sel = window.getSelection()
              if (sel && sel.toString().length > 0) return
              setExpanded(true)
            }}
          >
            <span className="text-neutral-600">{label}: </span>
            {oneLine}
          </span>
        )}
      </div>
    </div>
  )
}

function ToolCallView({ content }: { content: Extract<ViewContent, { kind: "tool_call" }> }) {
  const [expanded, setExpanded] = useState(false)
  const inputStr =
    typeof content.input === "string" ? content.input : JSON.stringify(content.input, null, 2)
  const outputStr =
    content.output !== undefined
      ? typeof content.output === "string"
        ? content.output
        : JSON.stringify(content.output, null, 2)
      : null
  const paramsOneLine =
    typeof content.input === "string"
      ? content.input.replace(/\n/g, " ")
      : JSON.stringify(content.input).replace(/,/g, ", ")

  return (
    <div className="my-1 border border-neutral-800 text-sm">
      <div
        className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-900"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="shrink-0 text-neutral-600">{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className="font-mono text-yellow-500">{content.name}</span>
        {!expanded && (
          <span className="min-w-0 flex-1 truncate font-mono text-neutral-500">
            {paramsOneLine}
          </span>
        )}
      </div>
      {expanded && (
        <div className="border-t border-neutral-800 px-2 py-1">
          <CollapsiblePre label="params" text={inputStr} className="text-neutral-500" />
          {outputStr && (
            <div className="mt-1 border-t border-neutral-800 pt-1">
              <CollapsiblePre label="result" text={outputStr} className="text-neutral-300" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const MessageGroupComponent = memo(function MessageGroupComponent({
  group,
}: {
  group: MessageGroup
}) {
  const isUser = group.role === "user"

  return (
    <div className="mb-4">
      <div className={`font-bold ${isUser ? "text-white" : "text-green-400"}`}>
        &gt; {isUser ? "you" : "heartbeat"}
      </div>
      {group.nodes.map((node) => (
        <NodeContent key={node.id} node={node} />
      ))}
    </div>
  )
})

function NodeContent({ node }: { node: ViewNode }) {
  return (
    <>
      <ContentView content={node.content} />
      {node.branches.map((branch, i) => (
        <BranchView key={i} branch={branch} />
      ))}
    </>
  )
}

function BranchView({ branch }: { branch: ViewNode[] }) {
  const [expanded, setExpanded] = useState(false)

  if (branch.length === 0) return null

  const agentLabel = `agent-${branch[0]!.runId.replace(/-/g, "").slice(-7)}`

  return (
    <div className="mt-2 border-l-4 border-neutral-700 pl-2 sm:pl-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mb-1 text-xs text-neutral-600 hover:text-white"
      >
        {expanded ? "\u25BC" : "\u25B6"} <span className="text-green-700">{agentLabel}</span>
      </button>
      <div
        className={expanded ? "" : "flex max-h-[100px] flex-col-reverse overflow-hidden"}
        style={expanded ? undefined : { maskImage: "linear-gradient(transparent, black 40%)" }}
      >
        <div>
          <Thread nodes={branch} />
        </div>
      </div>
      {expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1 text-xs text-neutral-600 hover:text-white"
        >
          {"\u25B2"} collapse
        </button>
      )}
    </div>
  )
}

function Thread({ nodes }: { nodes: ViewNode[] }) {
  const groups = groupNodes(nodes)

  return (
    <>
      {groups.map((group) => (
        <MessageGroupComponent
          key={`${group.runId}-${group.nodes[0]!.id}`}
          group={group}
        />
      ))}
    </>
  )
}

export function ConversationThread({ graph }: ConversationThreadProps) {
  const viewNodes = projectThread(graph)

  if (viewNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-600">
        no data for this session.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Thread nodes={viewNodes} />
    </div>
  )
}
